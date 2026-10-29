import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { streamChat, type ChatSseEvent } from '../lib/chat'
import { api, normalizeCatalogModel, type CatalogModel } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { Button, Card, Credits, Select } from '../components/ui'

type Model = CatalogModel

type ByokKey = {
  id: string
  label: string
  base_url: string
  upstream_model: string
  key_masked: string
  status: 'live' | 'slow' | 'down' | 'unknown' | 'disabled'
  avg_latency_ms: number | null
}

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  error?: string
  model?: string | null
  cost?: {
    credits: number | null
    input: number | null
    output: number | null
    total: number | null
    source: string
    status: string
    model: string | null
    latencyMs: number | null
    firstTokenMs: number | null
    tokensPerSec: number | null
  }
}

// One human-readable note for a finished message's footer: Your Key calls stay
// free, and a Pool call is described by how it was billed — the provider's
// reported usage, the flat rate when usage never arrived, or the flat rate
// charged for a stream the caller stopped early.
function billingNote(mode: 'pool' | 'byok', cost: NonNullable<Message['cost']>): string {
  if (mode === 'byok') return ' · Free — your key'
  if (cost.status === 'aborted') return ' · flat rate — stream stopped'
  if (cost.source === 'reported') return ` · reported by ${cost.model ?? 'provider'}`
  if (cost.source === 'flat_rate') return ' · flat rate — usage unreported'
  return ''
}

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
}

const CHAT_STORAGE_KEY = 'freellm:chat:v1'

type ChatPersisted = { mode?: 'pool' | 'byok'; selectedModel?: string; selectedKeyId?: string }

function loadChatPersisted(): ChatPersisted {
  try {
    return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveChatPersisted(state: ChatPersisted) {
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(state))
}

function requestClock(): number {
  return Date.now()
}

export default function Chat() {
  const { user, loading: authLoading, refresh } = useAuth()
  const [searchParams] = useSearchParams()
  const [models, setModels] = useState<Model[]>([])
  const [selected, setSelected] = useState<string>(() => loadChatPersisted().selectedModel ?? '')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'warn' | 'err'; text: string; action?: { label: string; to: string } } | null>(null)
  const [mode, setMode] = useState<'pool' | 'byok'>(() => loadChatPersisted().mode ?? 'pool')
  const [byokKeys, setByokKeys] = useState<ByokKey[]>([])
  const [byokLoading, setByokLoading] = useState(false)
  const [selectedKeyId, setSelectedKeyId] = useState<string>(() => loadChatPersisted().selectedKeyId ?? '')
  const abortRef = useRef<AbortController | null>(null)
  const lastInputRef = useRef('')
  const [retryAvailable, setRetryAvailable] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pendingRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const stickRef = useRef(true)
  const [pinned, setPinned] = useState(true)
  const navigate = useNavigate()

  const loadModels = useCallback(async () => {
    try {
      const data = await api.get<{ models: unknown }>('/models')
      const catalog = Array.isArray(data?.models) ? data.models.map(normalizeCatalogModel) : []
      setModels(catalog)
      const wanted = searchParams.get('model')
      const saved = loadChatPersisted().selectedModel
      if (wanted && catalog.some((m) => m.slug === wanted)) setSelected(wanted)
      else if (saved && catalog.some((m) => m.slug === saved)) setSelected(saved)
      else if (catalog.length > 0) setSelected((prev) => prev || catalog[0].slug)
    } catch {
      setBanner({ kind: 'err', text: 'Could not load the model catalog.' })
    }
  }, [searchParams])

  const loadByokKeys = useCallback(async () => {
    if (!user) return
    setByokLoading(true)
    try {
      const data = await api.get<{ keys: ByokKey[] }>('/keys')
      const liveKeys = data.keys.filter((k) => k.status !== 'disabled')
      setByokKeys(liveKeys)
      if (!selectedKeyId && liveKeys.length > 0) {
        setSelectedKeyId(liveKeys[0].id)
        saveChatPersisted({ ...loadChatPersisted(), selectedKeyId: liveKeys[0].id })
      }
    } catch {
      setBanner({ kind: 'err', text: 'Could not load your keys.' })
    } finally {
      setByokLoading(false)
    }
  }, [user, selectedKeyId])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- catalog load on mount/user change
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    const modeParam = searchParams.get('mode')
    const keyParam = searchParams.get('key')
    if (modeParam === 'byok' || modeParam === 'pool') {
      // oxlint-disable-next-line react/set-state-in-effect -- URL params are an external store to sync from
      setMode(modeParam)
    }
    if (keyParam) {
      setSelectedKeyId(keyParam)
      setMode('byok')
    }
  }, [searchParams])

  useEffect(() => {
    if (mode === 'byok') {
      // oxlint-disable-next-line react/set-state-in-effect -- vault keys load when BYOK mode is entered
      void loadByokKeys()
    }
  }, [mode, loadByokKeys])

  useEffect(() => {
    saveChatPersisted({
      ...loadChatPersisted(),
      mode,
      selectedModel: selected,
      selectedKeyId,
    })
  }, [mode, selected, selectedKeyId])

  const messageCount = messages.length
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messageCount, stickRef])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      pendingRef.current = ''
    }
  }, [])

  const model = models.find((m) => m.slug === selected) ?? null
  const selectedKey = byokKeys.find((k) => k.id === selectedKeyId) ?? null

  /** Appends buffered stream text in one paint, then follows only if pinned. */
  function flushPending(assistantId: string) {
    rafRef.current = null
    const text = pendingRef.current
    if (!text) return
    pendingRef.current = ''
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)),
    )
    if (stickRef.current) {
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (el && stickRef.current) el.scrollTop = el.scrollHeight
      })
    }
  }

  function scheduleFlush(assistantId: string) {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => flushPending(assistantId))
  }

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const pinnedNow = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickRef.current = pinnedNow
    setPinned(pinnedNow)
  }

  async function send(event?: FormEvent, overrideContent?: string) {
    event?.preventDefault()
    const content = (overrideContent ?? input).trim()
    if (!content || busy) return
    if (mode === 'pool' && !model) return
    if (mode === 'byok' && !selectedKey) return
    if (mode === 'pool' && modelLocked) {
      setBanner({ kind: 'warn', text: `${model?.label ?? 'This model'} requires ${model?.access_tier} tier — upgrade not available yet.` })
      return
    }
    if (mode === 'pool' && model?.status === 'down') {
      setBanner({ kind: 'warn', text: `${model?.label ?? 'This model'} is down right now — pick another model. Failed requests are never charged.` })
      return
    }
    lastInputRef.current = content
    setRetryAvailable(false)

    abortRef.current?.abort()
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    pendingRef.current = ''

    const requestId = crypto.randomUUID()
    const userMessage: Message = { id: `u-${requestId}`, role: 'user', content }
    const assistantId = `a-${requestId}`
    const history = [...messages, userMessage]
    const requestModelSlug = mode === 'pool' ? (model?.slug ?? null) : null
    const requestModelLabel =
      mode === 'pool' ? (model?.label ?? 'assistant') : (selectedKey?.label ?? 'your key')
    const requestFlatRate = mode === 'pool' ? (model?.flat_rate_credits ?? 0) : 0
    const startedAt = requestClock()
    let firstTokenMs: number | null = null
    let latestUsage: { input: number | null; output: number | null; total: number | null; source: string } | null = null

    setMessages([
      ...history,
      { id: assistantId, role: 'assistant', content: '', streaming: true, model: requestModelLabel },
    ])
    setInput('')
    setBusy(true)
    setBanner(null)

    const controller = new AbortController()
    abortRef.current = controller

    const payload = {
      // Connection mode dials the caller's own credential, so the model slug is
      // optional — the stored upstream_model is the default. Pool mode requires it.
      model: requestModelSlug ?? selectedKey?.upstream_model ?? '',
      request_id: requestId,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      ...(mode === 'byok' && selectedKey ? { connection_id: selectedKey.id } : {}),
    }

    const result = await streamChat(
      payload,
      {
        onDelta: (chunk) => {
          if (firstTokenMs === null) firstTokenMs = requestClock() - startedAt
          pendingRef.current += chunk
          scheduleFlush(assistantId)
        },
        onUsage: (usage) => {
          latestUsage = usage
          flushPending(assistantId)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    cost: {
                      credits: m.cost?.credits ?? null,
                      input: usage.input,
                      output: usage.output,
                      total: usage.total,
                      source: usage.source,
                      status: 'streaming',
                      model: requestModelLabel,
                      latencyMs: null,
                      firstTokenMs,
                      tokensPerSec: null,
                    },
                  }
                : m,
            ),
          )
        },
        onSettled: (settled: Extract<ChatSseEvent, { type: 'settled' }>) => {
          flushPending(assistantId)
          const latencyMs = requestClock() - startedAt
          const output = latestUsage?.output ?? null
          const tokensPerSec =
            typeof output === 'number' && output > 0 && latencyMs > 0 ? output / (latencyMs / 1000) : null
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    streaming: false,
                    cost: {
                      credits: settled.credits_charged,
                      input: latestUsage?.input ?? m.cost?.input ?? null,
                      output: latestUsage?.output ?? m.cost?.output ?? null,
                      total: latestUsage?.total ?? m.cost?.total ?? null,
                      source: latestUsage?.source ?? m.cost?.source ?? 'flat_rate',
                      status: settled.status,
                      model: requestModelLabel,
                      latencyMs,
                      firstTokenMs,
                      tokensPerSec,
                    },
                  }
                : m,
            ),
          )
        },
      },
      controller.signal,
    )

    abortRef.current = null
    setBusy(false)
    flushPending(assistantId)
    if (result.completed) {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)))
    } else {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)))
    }
    await refresh()

    if (!result.completed && result.error && result.error !== 'aborted') {
      const failedAssistantId = assistantId
      setMessages((prev) =>
        prev.map((m) =>
          m.id === failedAssistantId && m.content === ''
            ? { ...m, streaming: false, error: result.error }
            : { ...m, streaming: false },
        ),
      )
      if (result.status === 402) {
        setBanner({
          kind: 'err',
          text: result.shortfall != null
            ? `Not enough credits — short by about ${result.shortfall.toLocaleString('en-US')} cr.`
            : result.error ?? 'Chat failed.',
          action: { label: 'Earn more', to: '/earn' },
        })
      } else if (result.status === 403) {
        setBanner({ kind: 'err', text: result.error ?? 'Chat failed.' })
      } else {
        setBanner({ kind: 'err', text: `${result.error ?? 'Chat failed.'} Nothing was charged.` })
        setRetryAvailable(true)
      }
    } else if (!result.completed && result.error === 'aborted') {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)))
      if (mode === 'byok') {
        setBanner({ kind: 'warn', text: 'Stream stopped — no charge in Your Key mode.' })
      } else {
        setBanner({ kind: 'warn', text: `Stream stopped — ${requestFlatRate.toLocaleString('en-US')} cr flat rate charged.` })
      }
    } else if (!result.completed) {
      // stream completed without settled (e.g., no usage block) — still stop streaming UI
      setRetryAvailable(false)
    }
  }

  function stop() {
    abortRef.current?.abort()
    setBusy(false)
  }

  useEffect(() => {
    if (!busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  if (authLoading) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>
  if (!user) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Chat</h1>
        <p className="mt-2 text-[13px] text-muted">
          Sign in to chat with The Pool. Credits spend 1:1 on tokens — earn them on the{' '}
          <Link to="/earn" className="text-accent hover:underline">earn page</Link>, or bring your own key (free).
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link to="/login"><Button>Sign in with Google</Button></Link>
        </div>
      </Card>
    )
  }

  const TIER_RANK: Record<string, number> = { free: 0, pro: 1, enterprise: 2 }
  const userTierRank = TIER_RANK[user.tier ?? 'free'] ?? 0
  const modelTierRank = (tier: string | undefined) => TIER_RANK[tier ?? 'free'] ?? 0
  const modelLocked = !!model && model.access_tier !== 'free' && user.role !== 'admin' && userTierRank < modelTierRank(model.access_tier)

  const canSend = mode === 'pool' ? !!model && !modelLocked && model?.status !== 'down' && !!input.trim() : mode === 'byok' ? !!selectedKey && !!input.trim() : false
  const sendBlockReason =
    mode === 'byok'
      ? !selectedKey
        ? 'Pick a key from the dropdown to send.'
        : ''
      : !model
        ? 'Waiting for the model catalog to load.'
        : modelLocked
          ? `${model.label} needs ${model.access_tier} tier — ask an admin to upgrade, or pick a free model.`
          : model.status === 'down'
            ? `${model.label} is down right now — pick another model; failed requests are never charged.`
            : ''

  // Build dropdown options
  interface PoolOption {
    value: string
    label: string
    disabled: boolean
    status: 'unknown' | 'live' | 'slow' | 'down'
    tier: string
    flatRate: number
    [key: string]: unknown
  }
  interface ByokOption {
    value: string
    label: string
    status: 'live' | 'slow' | 'down' | 'unknown' | 'disabled'
    keyMasked: string
    latency: number | null
    [key: string]: unknown
  }

  const poolOptions: PoolOption[] = models.map((m) => ({
    value: m.slug,
    label: m.label,
    disabled: m.access_tier !== 'free' && user.role !== 'admin' && userTierRank < modelTierRank(m.access_tier),
    status: m.status,
    tier: m.access_tier,
    flatRate: m.flat_rate_credits,
  }))
  const byokOptions: ByokOption[] = byokKeys.map((k) => ({
    value: k.id,
    label: `${k.label} · ${k.upstream_model}`,
    status: k.status,
    keyMasked: k.key_masked,
    latency: k.avg_latency_ms,
  }))

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] lg:h-[calc(100vh-5rem)]">
      {/* Header with mode switch and model/key dropdown */}
      <header className="flex flex-col gap-3 p-4 bg-surface border-b border-line lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Chat</h1>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2" role="radiogroup" aria-label="Chat mode">
              <button
                role="radio"
                aria-checked={mode === 'pool'}
                onClick={() => { setMode('pool'); setSelectedKeyId('') }}
                className={`px-3 py-1.5 text-[12px] font-medium rounded transition-colors ${
                  mode === 'pool'
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-2 text-content hover:bg-surface-3 border-transparent'
                }`}
              >
                The Pool
              </button>
              <button
                role="radio"
                aria-checked={mode === 'byok'}
                onClick={() => setMode('byok')}
                className={`px-3 py-1.5 text-[12px] font-medium rounded transition-colors ${
                  mode === 'byok'
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-2 text-content hover:bg-surface-3 border-transparent'
                }`}
              >
                Your Key
              </button>
            </div>
            <p className="text-[11px] text-muted">{mode === 'pool' ? 'Uses credits (1 credit = 1 token). Earn more on Earn.' : 'Uses your own API key.'}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 lg:ml-auto">
          {mode === 'pool' ? (
            <div className="w-full sm:w-64 lg:w-72">
              <Select
                value={selected}
                onChange={setSelected}
                placeholder="Select a model…"
                options={poolOptions}
                renderOption={(opt) => (
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDot[opt.status]}`} aria-hidden="true" />
                    <span className="font-medium">{opt.label}</span>
                    {opt.tier !== 'free' && (
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        🔒 {opt.tier}
                      </span>
                    )}
                    {opt.disabled && <span className="text-[11px] text-muted ml-auto">locked</span>}
                  </div>
                )}
              />
            </div>
          ) : (
            <div className="w-full sm:w-64 lg:w-72">
              <Select
                value={selectedKeyId}
                onChange={setSelectedKeyId}
                placeholder="Select a key…"
                options={byokOptions}
                disabled={byokLoading}
                renderOption={(opt) => (
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDot[opt.status]}`} aria-hidden="true" />
                    <span className="font-medium truncate">{opt.label}</span>
                    <span className="num text-[11px] text-muted font-mono ml-auto">{opt.keyMasked}</span>
                    {opt.latency != null && (
                      <span className="num text-[11px] text-muted">{formatLatency(opt.latency)}</span>
                    )}
                  </div>
                )}
              />
            </div>
          )}
        </div>
      </header>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Active model/key info banner */}
        <div className="px-4 py-2 border-b border-line bg-surface-2/50 flex-shrink-0">
          {mode === 'pool' && model && (
            <div className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className={`h-2 w-2 rounded-full ${statusDot[model.status]}`} />
              <span className="font-semibold">{model.label}</span>
              <span className="text-muted">The Pool</span>
              {modelLocked && (
                <span className="text-warn">requires {model.access_tier} tier — upgrade not available yet</span>
              )}
              {model.scoped_only === 1 && (
                <span className="text-muted">scoped credits only — global balance can't buy this model</span>
              )}
              {model.status === 'down' && (
                <span className="text-warn">all configs down — requests will fail free</span>
              )}
            </div>
          )}
          {mode === 'byok' && selectedKey && (
            <div className="flex flex-wrap items-center gap-3 text-[13px] border-gain/30">
              <span className={`h-2 w-2 rounded-full ${statusDot[selectedKey.status]}`} />
              <span className="font-semibold">{selectedKey.label}</span>
              <span className="text-gain font-medium">Your Key (free)</span>
              <span className="num ml-auto text-muted font-mono">{selectedKey.key_masked}</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          role="log"
          aria-label="Chat messages"
          aria-busy={busy}
          tabIndex={0}
          className="flex-1 overflow-y-auto p-4 space-y-4"
        >
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-muted px-4">
              <p className="text-[13px] max-w-md">
                What is freellm.hasit.in? A community-owned arena for indie AI models. Bring your own key and chat free, or spend credits (1 cr = 1 token) on models in The Pool.
              </p>
              <p className="text-[13px]">
                Ask {mode === 'pool' ? (model?.label ?? 'a model') : (selectedKey?.label ?? 'your key')} anything.
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-2 max-w-md">
                {['Explain quantum entanglement simply', 'Write a Python quicksort', 'Summarize this in 3 bullets: ', 'Debug this code: '].map((p) => (
                  <button key={p} type="button" onClick={() => setInput(p)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] text-muted hover:text-content">{p}</button>
                ))}
              </div>
              <p className="num text-[12px] max-w-md">
                {mode === 'pool'
                  ? 'Billing uses the provider\'s reported token counts; the flat rate applies only when usage is unreported or a stream is stopped early.'
                  : 'Free — no balance check, no metering. Your key, your endpoint, your cost.'}
              </p>
              {mode === 'byok' && !selectedKey && (
                <Button variant="primary" onClick={() => navigate('/keys')}>Add a key to start</Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((m) => (
                <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className="flex flex-col gap-1 max-w-[85%]">
                    {m.role === 'assistant' && (
                      <p className="text-[12px] font-semibold text-accent ml-1">
                        {m.model ?? (mode === 'pool' ? (model?.label ?? 'assistant') : (selectedKey?.label ?? 'your key'))}
                      </p>
                    )}
                    <div
                      className={`inline-block max-w-full whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[13px] ${
                        m.role === 'user' ? 'bg-accent/15 rounded-tr-sm' : 'bg-surface-2 rounded-tl-sm'
                      }`}
                    >
                      {m.content || (m.streaming ? <span role="status" className="text-muted">thinking…</span> : null)}
                      {m.error && <span className="text-loss">{m.error}</span>}
                    </div>
                    {m.cost && (
                      <p className="num text-[11px] text-muted ml-1">
                        {m.cost.credits == null
                          ? 'billing pending — no charge recorded'
                          : `${m.cost.credits.toLocaleString('en-US')} cr`}
                        {m.cost.input != null && m.cost.output != null
                          ? ` — ${m.cost.input.toLocaleString('en-US')} in · ${m.cost.output.toLocaleString('en-US')} out`
                          : ''}
                        {billingNote(mode, m.cost)}
                        {m.cost.latencyMs != null ? ` · ${(m.cost.latencyMs / 1000).toFixed(2)}s` : ''}
                        {m.cost.firstTokenMs != null ? ` · first token ${(m.cost.firstTokenMs / 1000).toFixed(2)}s` : ''}
                        {m.cost.tokensPerSec != null ? ` · ${Math.round(m.cost.tokensPerSec)} tok/s` : ''}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!pinned && messages.length > 0 && (
            <button
              onClick={() => {
                stickRef.current = true
                setPinned(true)
                const el = scrollRef.current
                if (el) el.scrollTop = el.scrollHeight
              }}
              className="btn-secondary self-center shadow-lg"
            >
              Jump to latest ↓
            </button>
          )}
        </div>

        {/* Banner */}
        {banner && (
          <div className={`flex flex-wrap items-center gap-2 px-4 py-2 border-t border-line ${banner.kind === 'err' ? 'text-loss' : 'text-warn'} bg-surface/50 flex-shrink-0`}>
            <span className="flex-1 text-[13px]">{banner.text}</span>
            {banner.action && (
              <Link to={banner.action.to} className="text-accent hover:underline">{banner.action.label}</Link>
            )}
            {!busy && retryAvailable && (
              <button onClick={() => void send(undefined, lastInputRef.current)} className="text-accent hover:underline text-[13px]">
                Retry
              </button>
            )}
            <button onClick={() => setBanner(null)} className="min-h-[44px] px-2 text-muted hover:text-content" aria-label="Dismiss message">
              Dismiss
            </button>
          </div>
        )}

        {/* Low balance warning */}
        {mode === 'pool' && user.balance_credits < 100_000 && (
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-t border-line text-warn text-[13px] bg-surface/50 flex-shrink-0">
            <span>Low balance: <Credits value={user.balance_credits} /> cr — your streak check-in gives +50,000 cr.</span>
            <Link to="/earn" className="text-accent hover:underline">Earn more</Link>
          </div>
        )}

        {/* Composer - sticky at bottom */}
        <form className="flex items-end gap-2 p-4 border-t border-line bg-surface/50 flex-shrink-0" onSubmit={send}>
          <label className="sr-only" htmlFor="chat-input">Message</label>
          <textarea
            id="chat-input"
            className="input min-h-[48px] max-h-[200px] flex-1 resize-none text-[16px] sm:text-[13px]"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(e as unknown as FormEvent)
              }
            }}
            placeholder={mode === 'pool' ? (model ? `Ask ${model.label}…` : 'Ask anything…') : selectedKey ? `Ask via ${selectedKey.label}…` : 'Add a key on /keys…'}
            disabled={mode === 'byok' && !selectedKey}
            style={{ height: 'auto' }}
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={stop} title="Stop (Esc)">Stop</Button>
          ) : (
            <>
              {mode === 'pool' && (
                <span className="num text-[12px] text-muted">{user.balance_credits.toLocaleString('en-US')} cr</span>
              )}
              <Button type="submit" disabled={!canSend} title={canSend ? 'Send (Enter)' : sendBlockReason}>Send</Button>
            </>
          )}
        </form>
        <p className="num text-[11px] text-muted px-4 pb-4 flex-shrink-0">
          {mode === 'pool' ? (
            <>spendable: <Credits value={user.balance_credits} /> cr · Enter sends, Shift+Enter for a new line · Esc stops</>
          ) : (
            <>Your Key mode — free · Enter sends, Shift+Enter for a new line · Esc stops</>
          )}
        </p>
      </main>
    </div>
  )
}

function formatLatency(ms: number | null): string {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}