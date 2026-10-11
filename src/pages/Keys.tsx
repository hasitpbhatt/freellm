import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Card, CardHeader, Input } from '../components/ui'

type ByokKey = {
  id: string
  label: string
  base_url: string
  upstream_model: string
  key_masked: string
  status: 'live' | 'slow' | 'down' | 'unknown' | 'disabled'
  last_checked_at: number | null
  last_error: string | null
  avg_latency_ms: number | null
  messages_served: number
  created_at: number
}

type KeyTestResult = {
  ok: boolean
  status: 'live' | 'slow' | 'down' | 'unknown' | 'disabled'
  latencyMs: number
  error?: string
}

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
  disabled: 'bg-muted',
}

const statusLabel: Record<string, string> = {
  live: 'Live',
  slow: 'Slow',
  down: 'Down',
  unknown: 'Unknown',
  disabled: 'Disabled',
}

function formatTime(ts: number | null): string {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleString()
}

function formatLatency(ms: number | null): string {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

const STORAGE_KEY = 'freellm:keys:v1'

type PersistedState = { lastAddedId?: string; expandedIds?: string[] }

function loadPersisted(): PersistedState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function savePersisted(state: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export default function Keys() {
  const { user, loading: authLoading } = useAuth()
  const [keys, setKeys] = useState<ByokKey[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ label: '', base_url: '', upstream_model: '', api_key: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null)
  const [persisted, setPersisted] = useState<PersistedState>(() => loadPersisted())
  const [expandedIds, setExpandedIds] = useState<string[]>(() => loadPersisted().expandedIds ?? [])
  const [testingId, setTestingId] = useState<string | null>(null)

  const loadKeys = async () => {
    try {
      const data = await api.get<{ keys: ByokKey[] }>('/keys')
      setKeys(data.keys)
    } catch {
      setBanner({ kind: 'err', text: 'Failed to load your keys.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading) void loadKeys()
  }, [authLoading])

  useEffect(() => {
    savePersisted({ expandedIds })
  }, [expandedIds])

  const validateForm = () => {
    const e: Record<string, string> = {}
    if (!form.label.trim() || form.label.length > 80) e.label = 'Label (1–80 chars) is required.'
    try { new URL(form.base_url) } catch { e.base_url = 'Enter a valid base URL (e.g. https://api.openai.com/v1).' }
    if (!form.upstream_model.trim()) e.upstream_model = 'Upstream model name is required (e.g. gpt-4o).'
    if (!form.api_key.trim()) e.api_key = 'Paste your provider API key.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validateForm()) return
    setAdding(true)
    setBanner(null)
    try {
      const res = await api.post<{ key: ByokKey; test: KeyTestResult }>('/keys', {
        label: form.label.trim(),
        base_url: form.base_url.trim(),
        upstream_model: form.upstream_model.trim(),
        api_key: form.api_key.trim(),
      })
      setForm({ label: '', base_url: '', upstream_model: '', api_key: '' })
      setKeys((prev) => [res.key, ...prev])
      setPersisted((p) => ({ ...p, lastAddedId: res.key.id }))
      if (res.test.ok) {
        setBanner({ kind: 'ok', text: 'Key added and validated ✓' })
      } else {
        setBanner({ kind: 'warn', text: `Key added but validation failed: ${res.test.error}. Test again before using.` })
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `Add failed: ${msg}` })
    } finally {
      setAdding(false)
    }
  }

  const handleTest = async (id: string) => {
    setBanner(null)
    setTestingId(id)
    try {
      const res = await api.post<{ test: KeyTestResult }>(`/keys/${id}/test`)
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, ...res.test } : k)))
      setBanner({ kind: res.test.ok ? 'ok' : 'err', text: res.test.ok ? 'Key is live ✓' : `Test failed: ${res.test.error}` })
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `Test failed: ${msg}` })
    } finally {
      setTestingId(null)
    }
  }

  const handleDelete = async (key: ByokKey) => {
    if (!confirm(`Delete key "${key.label}"? Chats using it will need another key. This cannot be undone.`)) return
    try {
      await api.del(`/keys/${key.id}`)
      setKeys((prev) => prev.filter((k) => k.id !== key.id))
      setExpandedIds((prev) => prev.filter((e) => e !== key.id))
      setBanner({ kind: 'ok', text: `Key "${key.label}" deleted.` })
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `Delete failed: ${msg}` })
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id])
  }

  const isExpanded = (id: string) => expandedIds.includes(id)

  if (authLoading) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>
  if (!user) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Your Keys</h1>
        <p className="mt-2 text-[13px] text-muted">
          Sign in to store your own provider keys and chat free.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link to="/login"><Button>Sign in with Google</Button></Link>
        </div>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:max-w-3xl mx-auto">
      <Card className="flex flex-col gap-3 p-6">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold">Your Keys</h1>
          <span className="num text-[13px] text-muted">Door 1 of Two Doors</span>
        </div>
        <p className="text-[13px] text-muted max-w-2xl">
          Bring your own OpenAI-compatible endpoint. Chatting through your key is <strong>free and unmetered</strong> —
          it never touches The Pool. Keys are encrypted at rest (AES-256-GCM); only you and the operator can reveal them.
        </p>
        <p className="text-[12px] text-warn">
          ⚠ Security: Keys are stored encrypted. The operator has a "reveal" button for auditability.
          Do not share your freellm account if you use sensitive provider keys.
        </p>
      </Card>

      <Card>
        <CardHeader title={adding ? 'Adding key…' : 'Add a key'} />
        <form onSubmit={handleAdd} className="p-6 space-y-4">
          <div>
            <label className="block text-[12px] font-medium mb-1">Label</label>
            <Input
              value={form.label}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. My OpenAI, Team Anthropic proxy"
              className={errors.label ? 'border-loss' : ''}
            />
            {errors.label && <p className="mt-1 text-[12px] text-loss">{errors.label}</p>}
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1">Base URL</label>
            <Input
              value={form.base_url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, base_url: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className={errors.base_url ? 'border-loss' : ''}
            />
            {errors.base_url && <p className="mt-1 text-[12px] text-loss">{errors.base_url}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[12px] font-medium mb-1">Upstream Model</label>
              <Input
                value={form.upstream_model}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, upstream_model: e.target.value })}
                placeholder="gpt-4o"
                className={errors.upstream_model ? 'border-loss' : ''}
              />
              {errors.upstream_model && <p className="mt-1 text-[12px] text-loss">{errors.upstream_model}</p>}
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1">API Key</label>
              <Input
                type="password"
                value={form.api_key}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, api_key: e.target.value })}
                placeholder="sk-…"
                className={errors.api_key ? 'border-loss' : ''}
              />
              {errors.api_key && <p className="mt-1 text-[12px] text-loss">{errors.api_key}</p>}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setForm({ label: '', base_url: '', upstream_model: '', api_key: '' })}>Clear</Button>
            <Button type="submit" disabled={adding}>{adding ? 'Validating…' : 'Add & validate'}</Button>
          </div>
        </form>
      </Card>

      {banner && (
        <Card className={`border-${banner.kind === 'ok' ? 'gain' : banner.kind === 'err' ? 'loss' : 'warn'}`}>
          <div className="flex items-start gap-2 p-4">
            <p role={banner.kind === 'err' ? 'alert' : 'status'} className="flex-1 text-[13px]">{banner.text}</p>
            <button onClick={() => setBanner(null)} className="min-h-[44px] px-2 text-[12px] text-muted hover:text-content" aria-label="Dismiss message">
              Dismiss
            </button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Stored keys" />
        {loading ? (
          <div className="p-6 text-center text-[13px] text-muted">Loading keys…</div>
        ) : keys.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-muted">
            No keys yet. Add one above to start chatting for free.
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {keys.map((k) => {
              const isDown = k.status === 'down' || k.status === 'disabled'
              const isNew = persisted.lastAddedId === k.id
              return (
                <div key={k.id} className={`card p-3 ${isNew ? 'border-gain/50' : ''} ${isDown ? 'opacity-70' : ''}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => toggleExpand(k.id)}
                        className="flex items-center gap-2 p-1 rounded hover:bg-surface-2 transition-colors"
                        aria-expanded={isExpanded(k.id)}
                        aria-label={isExpanded(k.id) ? 'Collapse details' : 'Expand details'}
                      >
                        <span className={`h-2 w-2 rounded-full ${statusDot[k.status]}`} />
                        <span className="font-medium">{k.label}</span>
                        <span className={`num rounded px-1.5 py-0.5 text-[10px] ${isDown ? 'bg-loss/20 text-loss' : 'bg-gain/20 text-gain'}`}>
                          {statusLabel[k.status]}
                        </span>
                        {isNew && <span className="num rounded bg-gain/20 px-1.5 py-0.5 text-[10px] text-gain">New</span>}
                        <span className="num font-mono text-[11px] text-muted">{k.key_masked}</span>
                        <span className="text-muted">▾</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => handleTest(k.id)} disabled={testingId === k.id || adding}>
                        {testingId === k.id ? 'Testing…' : 'Test'}
                      </Button>
                      <Link to="/chat" className="btn-secondary btn-sm">Use in chat</Link>
                      <Button variant="secondary" size="sm" className="text-loss hover:bg-loss/10" onClick={() => handleDelete(k)}>Delete</Button>
                    </div>
                  </div>
                  {isExpanded(k.id) && (
                    <div className="mt-3 pt-3 border-t border-line space-y-1 text-[12px] text-muted">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        <div className="min-w-0 break-all"><span className="font-medium">Base URL:</span> {k.base_url}</div>
                        <div className="min-w-0 break-all"><span className="font-medium">Upstream model:</span> <code className="font-mono">{k.upstream_model}</code></div>
                        <div><span className="font-medium">Latency:</span> {formatLatency(k.avg_latency_ms)}</div>
                        <div><span className="font-medium">Messages served:</span> {k.messages_served}</div>
                        <div><span className="font-medium">Added:</span> {formatTime(k.created_at)}</div>
                        <div><span className="font-medium">Last checked:</span> {formatTime(k.last_checked_at)}</div>
                        {k.last_error && (
                          <div className="min-w-0 break-all sm:col-span-2 text-loss"><span className="font-medium">Last error:</span> {k.last_error}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="p-4 border-accent/30">
        <p className="text-[13px] text-center text-muted">
          <strong>Door 1 — Your Key:</strong> free, your endpoint, your key, no balance check.
          <br />
          <strong>Door 2 — The Pool:</strong> community-funded models, 1 cr = 1 token, earn on /earn.
        </p>
      </Card>
    </div>
  )
}