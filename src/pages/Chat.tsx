import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { streamChat, type ChatSseEvent } from '../lib/chat'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Card, Credits } from '../components/ui'

type Model = {
  slug: string
  label: string
  description: string | null
  capabilities: string[]
  context_window: number | null
  max_output_tokens: number
  flat_rate_credits: number
  routing: string
  status: 'live' | 'slow' | 'down' | 'unknown'
  provider_count: number
}

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
  cost?: { credits: number; input: number | null; output: number | null; total: number | null; source: string; status: string }
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

export default function Chat() {
  const { user, loading: authLoading, refresh } = useAuth()
  const [searchParams] = useSearchParams()
  const [models, setModels] = useState<Model[]>([])
  const [selected, setSelected] = useState<string>('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'warn' | 'err'; text: string } | null>(null)
  const [mode, setMode] = useState<'pool' | 'byok'>(() => loadChatPersisted().mode ?? 'pool')
  const [byokKeys, setByokKeys] = useState<ByokKey[]>([])
  const [byokLoading, setByokLoading] = useState(false)
  const [selectedKeyId, setSelectedKeyId] = useState<string>(() => loadChatPersisted().selectedKeyId ?? '')
  const abortRef = useRef<AbortController | null>(null)
  const streamEndRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()

  const loadModels = useCallback(async () => {
    try {
      const data = await api.get<{ models: Model[] }>('/models')
      setModels(data.models)
      const wanted = searchParams.get('model')
      if (wanted && data.models.some((m) => m.slug === wanted)) setSelected(wanted)
      else if (data.models.length > 0) setSelected((prev) => prev || data.models[0].slug)
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

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const model = models.find((m) => m.slug === selected) ?? null
  const selectedKey = byokKeys.find((k) => k.id === selectedKeyId) ?? null

  async function send(event: FormEvent) {
    event.preventDefault()
    const content = input.trim()
    if (!content || busy) return
    if (mode === 'pool' && !model) return
    if (mode === 'byok' && !selectedKey) return

    const requestId = crypto.randomUUID()
    const userMessage: Message = { id: `u-${requestId}`, role: 'user', content }
    const assistantId = `a-${requestId}`
    const history = [...messages, userMessage]

    setMessages([...history, { id: assistantId, role: 'assistant', content: '', streaming: true }])
    setInput('')
    setBusy(true)
    setBanner(null)

    const controller = new AbortController()
    abortRef.current = controller

    const payload = {
      model: model?.slug ?? '',
      request_id: requestId,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      ...(mode === 'byok' && selectedKey ? { key_mode: 'byok' as const, key_id: selectedKey.id } : {}),
    }

    const result = await streamChat(
      payload,
      {
        onDelta: (chunk) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m)),
          )
        },
        onUsage: (usage) => {
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
                    },
                  }
                : m,
            ),
          )
        },
        onSettled: (settled: Extract<ChatSseEvent, { type: 'settled' }>) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    streaming: false,
                    cost: {
                      credits: settled.credits_charged,
                      input: m.cost?.input ?? null,
                      output: m.cost?.output ?? null,
                      total: m.cost?.total ?? null,
                      source: m.cost?.source ?? 'flat_rate',
                      status: settled.status,
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
    await refresh()

    if (!result.completed && result.error && result.error !== 'aborted') {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.content === ''
            ? { ...m, streaming: false, error: result.error }
            : { ...m, streaming: false },
        ),
      )
      setBanner({ kind: 'err', text: result.error ?? 'Chat failed.' })
    } else if (!result.completed && result.error === 'aborted') {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)))
      const flatRate = model?.flat_rate_credits ?? 0
      setBanner({ kind: 'warn', text: `Stream stopped — ${flatRate.toLocaleString('en-US')} cr flat rate charged.` })
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
          <Link to="/register"><Button>Create account</Button></Link>
          <Link to="/login"><Button variant="secondary">Sign in</Button></Link>
        </div>
      </Card>
    )
  }

  const canSend = mode === 'pool' ? !!model && !!input.trim() : mode === 'byok' ? !!selectedKey && !!input.trim() : false

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <div className="flex flex-col gap-3">
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

        {mode === 'pool' ? (
          <>
            {models.length === 0 && (
              <p className="text-[13px] text-muted">
                No models yet. An admin can add them in{' '}
                <Link to="/admin" className="text-accent hover:underline">/admin</Link>.
              </p>
            )}
            {models.map((m) => (
              <button
                key={m.slug}
                onClick={() => setSelected(m.slug)}
                className={`card flex flex-col gap-1 p-3 text-left transition-colors ${
                  selected === m.slug ? 'border-accent' : 'hover:border-muted'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${statusDot[m.status]}`} />
                  <span className="text-[13px] font-medium">{m.label}</span>
                </span>
                <span className="num text-[11px] text-muted">
                  flat {m.flat_rate_credits.toLocaleString('en-US')} cr · {m.provider_count} config{m.provider_count === 1 ? '' : 's'}
                </span>
                {m.capabilities.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {m.capabilities.slice(0, 3).map((tag) => (
                      <span key={tag} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{tag}</span>
                    ))}
                  </span>
                )}
              </button>
            ))}
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
              byokKeys.map((k) => (
                <button
                  key={k.id}
                  onClick={() => setSelectedKeyId(k.id)}
                  className={`card flex flex-col gap-1 p-3 text-left transition-colors ${
                    selectedKeyId === k.id ? 'border-accent' : 'hover:border-muted'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${statusDot[k.status]}`} />
                    <span className="text-[13px] font-medium">{k.label}</span>
                  </span>
                  <span className="num text-[11px] text-muted">
                    {formatLatency(k.avg_latency_ms)} · {k.upstream_model}
                  </span>
                  <span className="num font-mono text-[11px] text-muted">{k.key_masked}</span>
                </button>
              ))
            )}
          </>
        )}
      </div>

      <div className="flex min-h-[70vh] flex-col gap-3">
        {mode === 'pool' && model && (
          <Card className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className={`h-2 w-2 rounded-full ${statusDot[model.status]}`} />
            <span className="text-[13px] font-semibold">{model.label}</span>
            <span className="text-[12px] text-muted">The Pool</span>
            <span className="num ml-auto text-[12px] text-muted">
              flat {model.flat_rate_credits.toLocaleString('en-US')} cr if usage unreported
            </span>
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

        <Card className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
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
                      {mode === 'pool' ? (model?.label ?? 'assistant') : (selectedKey?.label ?? 'your key')}
                    </p>
                  )}
                  <div
                    className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-[13px] ${
                      m.role === 'user' ? 'bg-accent/15' : 'bg-surface-2'
                    }`}
                  >
                    {m.content || (m.streaming ? <span className="text-muted">thinking…</span> : null)}
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
                        ? ` · reported by ${model?.label ?? 'provider'}`
                        : m.cost.source === 'flat_rate'
                        ? ' · flat rate — usage unreported'
                        : ''}
                    </p>
                  )}
                </div>
              ))}
              <div ref={streamEndRef} />
            </div>
          )}
        </Card>

        {banner && (
          <p className={`text-[13px] ${banner.kind === 'err' ? 'text-loss' : 'text-warn'}`}>{banner.text}</p>
        )}

        {mode === 'pool' && user.balance_credits < 100_000 && (
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-warn">
            Running low — your streak check-in gives +50,000 cr.
            <Link to="/earn" className="text-accent hover:underline">Earn more</Link>
          </p>
        )}

        <form className="flex items-end gap-2" onSubmit={send}>
          <textarea
            className="input min-h-[42px] flex-1 resize-none"
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
            <Button type="button" variant="secondary" onClick={stop}>Stop</Button>
          ) : (
            <Button type="submit" disabled={!canSend}>Send</Button>
          )}
        </form>
        <p className="num text-[12px] text-muted">
          {mode === 'pool' ? (
            <>spendable: <Credits value={user.balance_credits} /> cr · Enter sends · Esc stops</>
          ) : (
            <>Your Key mode — free · Enter sends · Esc stops</>
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