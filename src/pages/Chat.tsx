import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { streamChat, type ChatSseEvent } from '../lib/chat'
import { api, normalizeCatalogModel, type CatalogModel } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Card, Credits } from '../components/ui'

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
    credits: number
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
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    if (mode === 'byok') void loadByokKeys()
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
    // New bubbles stick to the bottom instantly. Per-token scrolling is
    // handled directly (without smooth animation) in the stream flush path.
    stickRef.current = true
    setPinned(true)
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messageCount])

  useEffect(() => {
    // Abort in-flight stream + drop scheduled paint on unmount.
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
      // Scroll after paint so the new height is already laid out.
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
      setBanner({ kind: 'warn', text: `${model?.label ?? 'This model'} requires ${model?.access_tier} tier — contact an admin to upgrade.` })
      return
    }
    if (mode === 'pool' && model?.status === 'down') {
      setBanner({ kind: 'warn', text: `${model?.label ?? 'This model'} is down right now — pick another model. Failed requests are never charged.` })
      return
    }
    lastInputRef.current = content
    setRetryAvailable(false)

    // Never overlap streams sharing pendingRef/rafRef — abort stale first.
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
      model: requestModelSlug ?? '',
      request_id: requestId,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      ...(mode === 'byok' && selectedKey ? { key_mode: 'byok' as const, key_id: selectedKey.id } : {}),
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
                      credits: m.cost?.credits ?? 0,
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
    // Paint any text still buffered before marking the bubble done.
    flushPending(assistantId)
    if (result.completed) {
      // A successful stream always leaves streaming mode, even if the final
      // billing event was lost before the connection closed.
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
        ? 'Pick one of your keys on the left to send.'
        : ''
      : !model
        ? 'Waiting for the model catalog to load.'
        : modelLocked
          ? `${model.label} needs ${model.access_tier} tier — ask an admin to upgrade, or pick a free model.`
          : model.status === 'down'
            ? `${model.label} is down right now — pick another model; failed requests are never charged.`
            : ''

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[220px_1fr]">
      <div className="order-2 flex flex-col gap-3 lg:order-1">
        <Card className="p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Mode</p>
          <div className="flex gap-2" role="radiogroup" aria-label="Chat mode">
            <button
              role="radio"
              aria-checked={mode === 'pool'}
              onClick={() => { setMode('pool'); setSelectedKeyId('') }}
              className={`flex-1 px-3 py-2 text-[12px] font-medium rounded transition-colors ${
                mode === 'pool'
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-2 text-content hover:bg-surface-3 border-transparent'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${mode === 'pool' ? 'bg-white' : 'bg-muted'}`} />
                The Pool
              </span>
            </button>
            <button
              role="radio"
              aria-checked={mode === 'byok'}
              onClick={() => setMode('byok')}
              className={`flex-1 px-3 py-2 text-[12px] font-medium rounded transition-colors ${
                mode === 'byok'
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-2 text-content hover:bg-surface-3 border-transparent'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${mode === 'byok' ? 'bg-white' : 'bg-muted'}`} />
                Your Key
              </span>
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted text-center">
            {mode === 'pool'
              ? 'Community models · 1 cr = 1 token'
              : 'Your endpoint · Your key · Free'}
          </p>
        </Card>

        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">
          {mode === 'pool' ? 'The Pool' : 'Your Keys'}
        </h2>

        {/* Mobile: horizontal chip strip so the composer stays visible without
            scrolling past the whole catalog. Desktop keeps the card list. */}
        {mode === 'pool' ? (
          <>
            {models.length === 0 && (
              <p className="text-[13px] text-muted">
                No models yet. An admin can add them in{' '}
                <Link to="/admin" className="text-accent hover:underline">/admin</Link>.
              </p>
            )}
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {models.map((m) => (
              <button
                key={m.slug}
                onClick={() => setSelected(m.slug)}
                aria-pressed={selected === m.slug}
                title={
                  m.access_tier !== 'free'
                    ? `${m.label} — needs ${m.access_tier} tier`
                    : m.status === 'down'
                      ? `${m.label} — down right now`
                      : m.label
                }
                className={`card flex min-h-[44px] shrink-0 flex-col gap-1 p-3 text-left transition-colors lg:shrink ${
                  selected === m.slug ? 'border-accent' : 'hover:border-muted'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${statusDot[m.status]}`} aria-hidden="true" />
                  <span className="whitespace-nowrap text-[13px] font-medium lg:whitespace-normal">{m.label}</span>
                  <span className="sr-only">{m.status}</span>
                  {m.access_tier !== 'free' && (
                    <span className="rounded bg-accent/10 px-1 py-0.5 text-[10px] font-medium text-accent">
                      🔒 {m.access_tier}
                    </span>
                  )}
                </span>
                <span className="num hidden text-[11px] text-muted lg:block">
                  flat {m.flat_rate_credits.toLocaleString('en-US')} cr · {m.provider_count} config{m.provider_count === 1 ? '' : 's'}
                </span>
                {m.capabilities.length > 0 && (
                  <span className="hidden flex-wrap gap-1 lg:flex">
                    {m.capabilities.slice(0, 3).map((tag) => (
                      <span key={tag} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{tag}</span>
                    ))}
                  </span>
                )}
              </button>
            ))}
            </div>
          </>
        ) : (
          <>
            {byokLoading ? (
              <p className="text-[13px] text-muted text-center py-4">Loading your keys…</p>
            ) : byokKeys.length === 0 ? (
              <div className="flex flex-col gap-2 p-4 text-center">
                <p className="text-[13px] text-muted">No keys yet.</p>
                <Button variant="primary" size="sm" onClick={() => navigate('/keys')}>Add a key</Button>
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {byokKeys.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setSelectedKeyId(k.id)}
                  aria-pressed={selectedKeyId === k.id}
                  className={`card flex min-h-[44px] shrink-0 flex-col gap-1 p-3 text-left transition-colors lg:shrink ${
                    selectedKeyId === k.id ? 'border-accent' : 'hover:border-muted'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDot[k.status]}`} aria-hidden="true" />
                    <span className="whitespace-nowrap text-[13px] font-medium lg:whitespace-normal">{k.label}</span>
                    <span className="sr-only">{k.status}</span>
                  </span>
                  <span className="num hidden text-[11px] text-muted lg:block">
                    {formatLatency(k.avg_latency_ms)} · {k.upstream_model}
                  </span>
                  <span className="num hidden font-mono text-[11px] text-muted lg:block">{k.key_masked}</span>
                </button>
              ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="order-1 flex min-h-[70vh] flex-col gap-3 lg:order-2">
        {mode === 'pool' && model && (
          <Card className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className={`h-2 w-2 rounded-full ${statusDot[model.status]}`} />
            <span className="text-[13px] font-semibold">{model.label}</span>
            <span className="text-[12px] text-muted">The Pool</span>
            <span className="num ml-auto text-[12px] text-muted">
              flat {model.flat_rate_credits.toLocaleString('en-US')} cr if usage unreported
            </span>
            {modelLocked && (
              <span className="text-[12px] text-warn">requires {model.access_tier} tier — contact an admin to upgrade</span>
            )}
            {model.scoped_only === 1 && (
              <span className="text-[12px] text-muted">scoped credits only — global balance can't buy this model</span>
            )}
            {model.status === 'down' && (
              <span className="text-[12px] text-warn">all configs down — requests will fail free</span>
            )}
          </Card>
        )}
        {mode === 'byok' && selectedKey && (
          <Card className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-gain/30">
            <span className={`h-2 w-2 rounded-full ${statusDot[selectedKey.status]}`} />
            <span className="text-[13px] font-semibold">{selectedKey.label}</span>
            <span className="text-[12px] text-gain font-medium">Your Key (free)</span>
            <span className="num ml-auto text-[12px] text-muted font-mono">{selectedKey.key_masked}</span>
          </Card>
        )}

        <div ref={scrollRef} onScroll={handleScroll} role="log" aria-label="Chat messages" aria-busy={busy} tabIndex={0} className="card relative flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <p className="text-[13px] text-muted">
                What is freellm.hasit.in? A community-owned arena for indie AI models. Bring your own key and chat free, or spend credits (1 cr = 1 token) on models in The Pool.
              </p>
              <p className="text-[13px] text-muted">
                Ask {mode === 'pool' ? (model?.label ?? 'a model') : (selectedKey?.label ?? 'your key')} anything.
              </p>
              <p className="num text-[12px] text-muted max-w-md">
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
                <div key={m.id} className={m.role === 'user' ? 'text-right' : ''}>
                  {m.role === 'assistant' && (
                    <p className="mb-1 text-[12px] font-semibold text-accent">
                      {m.model ?? (mode === 'pool' ? (model?.label ?? 'assistant') : (selectedKey?.label ?? 'your key'))}
                    </p>
                  )}
                  <div
                    className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-[13px] ${
                      m.role === 'user' ? 'bg-accent/15' : 'bg-surface-2'
                    }`}
                  >
                    {m.content || (m.streaming ? <span role="status" className="text-muted">thinking…</span> : null)}
                    {m.error && <span className="text-loss">{m.error}</span>}
                  </div>
                  {m.cost && (
                    <p className="num mt-1 text-[12px] text-muted">
                      {m.cost.credits.toLocaleString('en-US')} cr
                      {m.cost.input != null && m.cost.output != null
                        ? ` — ${m.cost.input.toLocaleString('en-US')} in · ${m.cost.output.toLocaleString('en-US')} out`
                        : ''}
                      {mode === 'byok' ? ' · Free — your key' : m.cost.status === 'aborted'
                        ? ' · flat rate — stream stopped'
                        : m.cost.source === 'reported'
                        ? ` · reported by ${m.cost.model ?? 'provider'}`
                        : m.cost.source === 'flat_rate'
                        ? ' · flat rate — usage unreported'
                        : ''}
                      {m.cost.latencyMs != null ? ` · ${(m.cost.latencyMs / 1000).toFixed(2)}s` : ''}
                      {m.cost.firstTokenMs != null ? ` · first token ${(m.cost.firstTokenMs / 1000).toFixed(2)}s` : ''}
                      {m.cost.tokensPerSec != null ? ` · ${Math.round(m.cost.tokensPerSec)} tok/s` : ''}
                    </p>
                  )}
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
              className="btn-secondary sticky bottom-2 z-[5] self-center shadow-lg"
            >
              Jump to latest ↓
            </button>
          )}
        </div>

        {banner && (
          <p role="alert" className={`flex flex-wrap items-center gap-2 text-[13px] ${banner.kind === 'err' ? 'text-loss' : 'text-warn'}`}>
            <span className="flex-1">{banner.text}</span>
            {banner.action && (
              <Link to={banner.action.to} className="text-accent hover:underline">{banner.action.label}</Link>
            )}
            {!busy && retryAvailable && (
              <button onClick={() => void send(undefined, lastInputRef.current)} className="text-accent hover:underline">
                Retry
              </button>
            )}
            <button onClick={() => setBanner(null)} className="min-h-[44px] px-2 text-muted hover:text-content" aria-label="Dismiss message">
              Dismiss
            </button>
          </p>
        )}

        {mode === 'pool' && user.balance_credits < 100_000 && (
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-warn">
            <span>Low balance: <Credits value={user.balance_credits} /> cr — your streak check-in gives +50,000 cr.</span>
            <Link to="/earn" className="text-accent hover:underline">Earn more</Link>
          </p>
        )}

        {!busy && !canSend && input.trim() && (
          <p className="text-[13px] text-muted" role="status">{sendBlockReason}</p>
        )}
        <form className="flex items-end gap-2" onSubmit={send}>
          <label className="sr-only" htmlFor="chat-input">Message</label>
          <textarea
            id="chat-input"
            className="input min-h-[48px] flex-1 resize-none text-[16px] sm:text-[13px]"
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
          />
          {busy ? (
            <Button type="button" variant="secondary" onClick={stop} title="Stop (Esc)">Stop</Button>
          ) : (
            <Button type="submit" disabled={!canSend} title={canSend ? 'Send (Enter)' : sendBlockReason}>Send</Button>
          )}
        </form>
        <p className="num text-[12px] text-muted">
          {mode === 'pool' ? (
            <>spendable: <Credits value={user.balance_credits} /> cr · Enter sends, Shift+Enter for a new line · Esc stops</>
          ) : (
            <>Your Key mode — free · Enter sends, Shift+Enter for a new line · Esc stops</>
          )}
        </p>
      </div>
    </div>
  )
}

function formatLatency(ms: number | null): string {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}