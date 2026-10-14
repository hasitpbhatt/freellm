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
  auth_kind: 'api_key' | 'oauth'
  protocol: 'openai' | 'codex'
  account_id: string | null
  has_refresh_token: boolean
  expires_at: number | null
  expired: boolean
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
  const [form, setForm] = useState({ label: '', base_url: '', upstream_model: '', api_key: '', auth_kind: 'api_key' as 'api_key' | 'oauth', protocol: 'openai' as 'openai' | 'codex', account_id: '', refresh_token: '', expires_at: '' })
  const emptyForm = { label: '', base_url: '', upstream_model: '', api_key: '', auth_kind: 'api_key' as const, protocol: 'openai' as const, account_id: '', refresh_token: '', expires_at: '' }
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkKeys, setBulkKeys] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null)
  const [persisted, setPersisted] = useState<PersistedState>(() => loadPersisted())
  const [expandedIds, setExpandedIds] = useState<string[]>(() => loadPersisted().expandedIds ?? [])
  const [testingId, setTestingId] = useState<string | null>(null)
  const [oauthPolling, setOauthPolling] = useState<Record<string, { state: string; interval: number } | null>>({})
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

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
    if (form.protocol === 'codex') {
      // Base URL optional for Codex (defaults to the ChatGPT backend); when
      // given it must still be a valid absolute URL.
      if (form.base_url.trim() !== '') {
        try { new URL(form.base_url) } catch { e.base_url = 'Enter a valid base URL or leave empty for the default Codex endpoint.' }
      }
    } else {
      try { new URL(form.base_url) } catch { e.base_url = 'Enter a valid base URL (e.g. https://api.openai.com/v1).' }
    }
    if (!form.upstream_model.trim()) e.upstream_model = form.protocol === 'codex' ? 'Upstream model name is required (e.g. gpt-5.5).' : 'Upstream model name is required (e.g. gpt-4o).'
    if (form.protocol === 'codex' && form.auth_kind !== 'oauth') e.api_key = 'Codex accounts use your ChatGPT OAuth access token.'
    else if (!form.api_key.trim()) e.api_key = form.auth_kind === 'oauth' ? 'Paste your OAuth access token.' : 'Paste your provider API key.'
    if (form.auth_kind === 'oauth' && form.api_key.trim().length > 2048) e.api_key = 'OAuth access token is too long.'
    if (form.account_id.trim().length > 128) e.account_id = 'Account ID must be 1–128 characters.'
    if (form.auth_kind === 'oauth' && form.refresh_token.trim().length > 2048) e.refresh_token = 'Refresh token is too long.'
    if (form.auth_kind === 'oauth' && form.expires_at.trim() !== '') {
      const ms = Number(form.expires_at.trim())
      if (!Number.isInteger(ms) || ms <= 0) e.expires_at = 'Expiry must be a unix epoch timestamp in milliseconds.'
    }
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
        ...(form.base_url.trim() !== '' ? { base_url: form.base_url.trim() } : {}),
        upstream_model: form.upstream_model.trim(),
        api_key: form.api_key.trim(),
        auth_kind: form.auth_kind,
        protocol: form.protocol,
        ...(form.account_id.trim() !== '' ? { account_id: form.account_id.trim() } : {}),
        ...(form.auth_kind === 'oauth' && form.refresh_token.trim() !== '' ? { refresh_token: form.refresh_token.trim() } : {}),
        ...(form.auth_kind === 'oauth' && form.expires_at.trim() !== '' ? { expires_at: Number(form.expires_at.trim()) } : {}),
      })
      setForm({ ...emptyForm })
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

  const handleBulkAdd = async () => {
    setAdding(true)
    setBanner(null)
    try {
      const keysData = JSON.parse(bulkKeys)
      if (!Array.isArray(keysData)) {
        throw new Error('Expected a JSON array')
      }
      const res = await api.post<{ keys: Array<{ key: ByokKey; test: KeyTestResult }> }>('/keys', keysData)
      setBulkKeys('')
      setBulkMode(false)
      setKeys((prev) => [...res.keys.map(r => r.key), ...prev])
      const allOk = res.keys.every(r => r.test.ok)
      if (allOk) {
        setBanner({ kind: 'ok', text: `${res.keys.length} keys imported and validated ✓` })
      } else {
        const failed = res.keys.filter(r => !r.test.ok).length
        setBanner({ kind: 'warn', text: `${res.keys.length} keys imported, ${failed} failed validation. Test them before using.` })
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `Bulk import failed: ${msg}` })
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

  // OAuth connect handler
  const handleOAuthConnect = async () => {
    if (!form.protocol || !form.base_url.trim()) {
      setBanner({ kind: 'err', text: 'Please select account type and enter base URL first.' })
      return
    }

     // Determine provider from base_url or protocol
     const baseUrl = form.base_url.toLowerCase()
     let providerId: string | null = null
     
     if (baseUrl.includes('chatgpt.com') || form.protocol === 'codex') {
       providerId = 'codex'
     } else if (baseUrl.includes('googleapis.com') || baseUrl.includes('gemini')) {
       providerId = 'google'
     } else if (baseUrl.includes('qoder')) {
       providerId = 'qoder'
     } else if (baseUrl.includes('meta.com') || baseUrl.includes('antigravity')) {
       providerId = 'antigravity'
     } else if (baseUrl.includes('x.ai') || baseUrl.includes('grok')) {
       providerId = 'grok'
     }

    if (!providerId) {
      setBanner({ kind: 'err', text: 'Cannot determine OAuth provider from base URL. Supported: Codex, Google/Gemini, Qoder, Antigravity, Grok Build.' })
      return
    }

    setBanner(null)

    try {
      const res = await api.get<{ authUrl: string; state: string; deviceCode?: string; userCode?: string; verificationUri?: string; interval?: number; expiresIn?: number }>(`/oauth/start/${providerId}`)
      
      if (res.authUrl) {
        // For device code flow, show user code and start polling
        if (res.deviceCode) {
          setOauthPolling((prev) => ({
            ...prev,
            [providerId]: { state: res.state, interval: res.interval || 5 }
          }))
          
          // Open verification URL in new tab
          window.open(res.verificationUri, '_blank')
          
          // Start polling
          pollOAuthToken(providerId, res.state, res.interval || 5)
        } else {
          // Authorization code flow - redirect user
          // Use navigate instead of window.location for SPA routing
          window.location.assign(res.authUrl)
        }
        
        setBanner({ kind: 'ok', text: `${providerId}: OAuth flow started. Complete authorization in the opened window.` })
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `OAuth connect failed: ${msg}` })
    }
  }

  const pollOAuthToken = async (providerId: string, state: string, interval: number) => {
    const maxAttempts = 120 // 10 minutes at 5s interval
    let attempts = 0
    
    const poll = async () => {
      if (attempts >= maxAttempts) {
        setOauthPolling((prev) => {
          const next = { ...prev }
          delete next[providerId]
          return next
        })
        setBanner({ kind: 'err', text: 'OAuth authorization timed out.' })
        return
      }
      
      const pollingData = oauthPolling[providerId]
      if (!pollingData || pollingData.state !== state) {
        return // Polling cancelled or state changed
      }
      
      attempts++
      
      try {
        const res = await api.post<{ status: string; keyId?: string; error?: string }>(`/oauth/poll/${providerId}`, { state })
        
        if (res.status === 'success') {
          setOauthPolling((prev) => {
            const next = { ...prev }
            delete next[providerId]
            return next
          })
          setBanner({ kind: 'ok', text: 'OAuth token received and stored! Key added to your vault.' })
          void loadKeys()
          return
        }
        
        if (res.status === 'error') {
          setOauthPolling((prev) => {
            const next = { ...prev }
            delete next[providerId]
            return next
          })
          setBanner({ kind: 'err', text: `OAuth failed: ${res.error}` })
          return
        }
        
        // Still pending, continue polling
        setTimeout(poll, interval * 1000)
      } catch {
        setOauthPolling((prev) => {
          const next = { ...prev }
          delete next[providerId]
          return next
        })
        setBanner({ kind: 'err', text: 'OAuth polling failed.' })
      }
    }
    
    await poll()
  }

  const handleRefresh = async (id: string) => {
    setBanner(null)
    try {
      const res = await api.post<{ ok: boolean; expiresAt?: number; message?: string; error?: string }>(`/keys/${id}/refresh`)
      if (res.ok) {
        setBanner({ kind: 'ok', text: res.message || 'Token refreshed successfully' })
        void loadKeys()
      } else {
        setBanner({ kind: 'err', text: res.error || 'Refresh failed' })
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `Refresh failed: ${msg}` })
    }
  }

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
          it never touches The Pool. Add each account separately — multiple accounts are allowed, and each stays
          strictly yours (never pooled or shared). Use only tokens from your own provider accounts.
        </p>
        <p className="text-[12px] text-warn">
          ⚠ Security: API keys are stored encrypted and revealable to the operator for auditability.
          OAuth tokens are never revealable — not even to the operator. Do not share your freellm account
          if you use sensitive provider credentials.
        </p>
      </Card>

      <Card>
        <CardHeader title={adding ? 'Adding key…' : 'Add a key'} />
        <form onSubmit={handleAdd} className="p-6 space-y-4">
          <div>
            <label className="block text-[12px] font-medium mb-1">Account type</label>
            <div className="flex gap-2" role="radiogroup" aria-label="Account type">
              {(['openai', 'codex'] as const).map((protocol) => (
                <button
                  key={protocol}
                  type="button"
                  role="radio"
                  aria-checked={form.protocol === protocol}
                  onClick={() => setForm({ ...form, protocol, auth_kind: protocol === 'codex' ? 'oauth' : form.auth_kind })}
                  className={`rounded border px-3 py-2 text-[12px] ${form.protocol === protocol ? 'border-accent bg-accent/10 text-content' : 'border-line text-muted'}`}
                >
                  {protocol === 'openai' ? 'OpenAI-compatible' : 'Codex (ChatGPT)'}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {form.protocol === 'codex'
                ? 'Your own ChatGPT Codex account, dialled through the Responses API. One account per entry — add more for multi-account use.'
                : 'Any OpenAI-compatible endpoint with a bearer key or OAuth token.'}
            </p>
          </div>
          <div>
            <label className="block text-[12px] font-medium mb-1">Credential kind</label>
            <div className="flex gap-2" role="radiogroup" aria-label="Credential kind">
              {(['api_key', 'oauth'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={form.auth_kind === kind}
                  disabled={form.protocol === 'codex' && kind === 'api_key'}
                  onClick={() => setForm({ ...form, auth_kind: kind })}
                  className={`rounded border px-3 py-2 text-[12px] ${form.auth_kind === kind ? 'border-accent bg-accent/10 text-content' : 'border-line text-muted'} ${form.protocol === 'codex' && kind === 'api_key' ? 'opacity-40' : ''}`}
                >
                  {kind === 'api_key' ? 'API key' : 'OAuth token'}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {form.auth_kind === 'oauth'
                ? 'Your own OAuth access token for this endpoint (e.g. a token from your own Codex or Gemini account). One account per entry.'
                : 'A static bearer key for this endpoint.'}
            </p>
            {form.auth_kind === 'oauth' && (
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOAuthConnect()}
                  disabled={adding}
                  className="text-[12px]"
                >
                  Connect via OAuth (auto)
                </Button>
                <span className="self-center text-[11px] text-muted">or paste token manually below</span>
              </div>
            )}
          </div>
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
            <label className="block text-[12px] font-medium mb-1">Base URL{form.protocol === 'codex' ? ' (optional)' : ''}</label>
            <Input
              value={form.base_url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, base_url: e.target.value })}
              placeholder={form.protocol === 'codex' ? 'empty = default ChatGPT Codex endpoint' : 'https://api.openai.com/v1'}
              className={errors.base_url ? 'border-loss' : ''}
            />
            {errors.base_url && <p className="mt-1 text-[12px] text-loss">{errors.base_url}</p>}
          </div>
          {form.protocol === 'codex' && (
            <div>
              <label className="block text-[12px] font-medium mb-1">ChatGPT account ID (optional)</label>
              <Input
                value={form.account_id}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, account_id: e.target.value })}
                placeholder="Binds requests when you hold several Codex accounts"
                className={errors.account_id ? 'border-loss' : ''}
              />
              {errors.account_id && <p className="mt-1 text-[12px] text-loss">{errors.account_id}</p>}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-[12px] font-medium mb-1">Upstream Model</label>
              <Input
                value={form.upstream_model}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, upstream_model: e.target.value })}
                placeholder={form.protocol === 'codex' ? 'gpt-5.5' : 'gpt-4o'}
                className={errors.upstream_model ? 'border-loss' : ''}
              />
              {errors.upstream_model && <p className="mt-1 text-[12px] text-loss">{errors.upstream_model}</p>}
            </div>
            <div>
              <label className="block text-[12px] font-medium mb-1">{form.auth_kind === 'oauth' ? 'OAuth access token' : 'API Key'}</label>
              <Input
                type="password"
                value={form.api_key}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, api_key: e.target.value })}
                placeholder={form.auth_kind === 'oauth' ? 'ya29.… / Bearer token' : 'sk-…'}
                className={errors.api_key ? 'border-loss' : ''}
              />
              {errors.api_key && <p className="mt-1 text-[12px] text-loss">{errors.api_key}</p>}
            </div>
          </div>
          {form.auth_kind === 'oauth' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-[12px] font-medium mb-1">Refresh token (optional)</label>
                <Input
                  type="password"
                  value={form.refresh_token}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, refresh_token: e.target.value })}
                  placeholder="Stored encrypted, never shown again"
                  className={errors.refresh_token ? 'border-loss' : ''}
                />
                {errors.refresh_token && <p className="mt-1 text-[12px] text-loss">{errors.refresh_token}</p>}
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">Access-token expiry, epoch ms (optional)</label>
                <Input
                  value={form.expires_at}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, expires_at: e.target.value })}
                  placeholder="e.g. 1767225600000"
                  inputMode="numeric"
                  className={errors.expires_at ? 'border-loss' : ''}
                />
                {errors.expires_at && <p className="mt-1 text-[12px] text-loss">{errors.expires_at}</p>}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setForm({ ...emptyForm })}>Clear</Button>
            <Button type="button" variant="secondary" onClick={() => setBulkMode(!bulkMode)}>
              {bulkMode ? 'Single key' : 'Bulk import (paste JSON array)'}
            </Button>
            <Button type="submit" disabled={adding}>{adding ? 'Validating…' : 'Add & validate'}</Button>
          </div>
        </form>
      </Card>

      {bulkMode && (
        <Card>
          <CardHeader title="Bulk Import Keys" />
          <div className="p-6 space-y-4">
            <p className="text-[13px] text-muted">
              Paste a JSON array of key objects. Each object should have: label, base_url, upstream_model, api_key, auth_kind ('api_key' or 'oauth'), protocol ('openai' or 'codex'), and optional fields: account_id, refresh_token, expires_at.
            </p>
            <textarea
              value={bulkKeys}
              onChange={(e) => setBulkKeys(e.target.value)}
              placeholder='[
  {
    "label": "My OpenAI",
    "base_url": "https://api.openai.com/v1",
    "upstream_model": "gpt-4o",
    "api_key": "sk-...",
    "auth_kind": "api_key",
    "protocol": "openai"
  },
  {
    "label": "Team Anthropic",
    "base_url": "https://api.anthropic.com/v1",
    "upstream_model": "claude-3-opus",
    "api_key": "sk-ant-...",
    "auth_kind": "api_key",
    "protocol": "openai"
  }
]'
              className="w-full h-64 font-mono text-[12px] p-3 rounded border border-line bg-surface"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setBulkMode(false); setBulkKeys('') }}>Cancel</Button>
              <Button type="button" onClick={handleBulkAdd} disabled={adding || !bulkKeys.trim()}>
                {adding ? 'Validating…' : 'Import keys'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {form.auth_kind === 'oauth' && (
        <Card className="border-info/30 bg-info/5">
          <CardHeader title="How to get an OAuth token" />
          <div className="p-4 space-y-3 text-[12px] text-muted">
            <details className="group">
              <summary className="cursor-pointer font-medium text-content flex items-center gap-2">
                Provider-specific guides
                <span className="ml-auto text-[10px] text-muted group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="mt-2 space-y-2">
                <div className="p-2 rounded bg-surface border border-line">
                  <div className="font-medium text-content">Codex (ChatGPT)</div>
                  <div className="text-xs mt-1">Settings → Developer → OAuth tokens (starts with <code className="font-mono">ya29.</code>)</div>
                </div>
                <div className="p-2 rounded bg-surface border border-line">
                  <div className="font-medium text-content">Google / Gemini</div>
                  <div className="text-xs mt-1">Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs → Get access token (starts with <code className="font-mono">ya29.</code>)</div>
                </div>
                <div className="p-2 rounded bg-surface border border-line">
                  <div className="font-medium text-content">Qoder</div>
                  <div className="text-xs mt-1">Qoder Dashboard → API / Integrations section</div>
                </div>
                <div className="p-2 rounded bg-surface border border-line">
                  <div className="font-medium text-content">Antigravity</div>
                  <div className="text-xs mt-1">Antigravity Dashboard → Developer settings → OAuth</div>
                </div>
                <div className="p-2 rounded bg-surface border border-line">
                  <div className="font-medium text-content">Grok Build (xAI)</div>
                  <div className="text-xs mt-1">Device code flow — xAI auth page (https://auth.x.ai). No refresh token; token ~45 min expiry. Re-authenticate when expired.</div>
                </div>
                <div className="p-2 rounded bg-surface border border-line">
                  <div className="font-medium text-content">Custom / Open-source endpoints</div>
                  <div className="text-xs mt-1">Check provider's auth docs — usually under "OAuth", "API", or "Security" sections</div>
                </div>
                <div className="p-2 rounded bg-surface border border-line text-warn">
                  <div className="font-medium text-content">⚠ No OAuth (API key only)</div>
                  <div className="text-xs mt-1">OpenAI, Anthropic/Claude — use API keys instead (https://platform.openai.com/api-keys, https://console.anthropic.com/settings/keys)</div>
                  <div className="text-xs mt-1">xAI API (Grok) — API keys only (https://console.x.ai/); note: Grok Build CLI uses OAuth device code flow (see above)</div>
                </div>
              </div>
            </details>
            <details className="group">
              <summary className="cursor-pointer font-medium text-content flex items-center gap-2">
                General tips
                <span className="ml-auto text-[10px] text-muted group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="mt-2 space-y-1 text-xs">
                <div>• OAuth tokens are typically long strings (100+ characters)</div>
                <div>• Unlike API keys, OAuth tokens expire — you may need a refresh token for long-term use</div>
                <div>• If your provider doesn't offer OAuth, use an API key instead (select "API key" above)</div>
                <div>• You can add multiple accounts from the same provider — each entry is independent</div>
              </div>
            </details>
            <details className="group">
              <summary className="cursor-pointer font-medium text-content flex items-center gap-2">
                Refresh token (optional field)
                <span className="ml-auto text-[10px] text-muted group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="mt-2 space-y-1 text-xs">
                <div>• Some providers issue a refresh token alongside the access token</div>
                <div>• If available, paste it here — freellm stores it encrypted and never shows it again</div>
                <div>• Without a refresh token, you'll need to manually update the access token when it expires</div>
                <div>• The expiry field (epoch ms) is optional but helps show "Expired" status before use</div>
              </div>
            </details>
          </div>
        </Card>
      )}

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
                        {k.auth_kind === 'oauth' && <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">OAuth</span>}
                        {k.auth_kind === 'api_key' && <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">API key</span>}
                        {k.protocol === 'codex' && <span className="num rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">Codex</span>}
                        {k.expired && <span className="num rounded bg-loss/20 px-1.5 py-0.5 text-[10px] text-loss">Expired</span>}
                        {k.auth_kind === 'oauth' && k.expires_at && !k.expired && (
                          <span className="num rounded bg-warn/20 px-1.5 py-0.5 text-[10px] text-warn">
                            Expires in {Math.ceil((k.expires_at - now) / 86400000)}d
                          </span>
                        )}
                        <span className="num font-mono text-[11px] text-muted">{k.key_masked}</span>
                        <span className="text-muted">▾</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => handleTest(k.id)} disabled={testingId === k.id || adding}>
                        {testingId === k.id ? 'Testing…' : 'Test'}
                      </Button>
                      {k.auth_kind === 'oauth' && k.has_refresh_token && (
                        <Button variant="secondary" size="sm" onClick={() => handleRefresh(k.id)}>
                          Refresh Token
                        </Button>
                      )}
                      <Link to={`/chat?mode=byok&key=${k.id}`} className="btn-secondary btn-sm">Use in chat</Link>
                      <Button variant="secondary" size="sm" className="text-loss hover:bg-loss/10" onClick={() => handleDelete(k)}>Delete</Button>
                    </div>
                  </div>
                  {isExpanded(k.id) && (
                    <div className="mt-3 pt-3 border-t border-line space-y-1 text-[12px] text-muted">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        <div className="min-w-0 break-all"><span className="font-medium">Base URL:</span> {k.base_url}</div>
                        <div className="min-w-0 break-all"><span className="font-medium">Upstream model:</span> <code className="font-mono">{k.upstream_model}</code></div>
                        {k.protocol === 'codex' && <div><span className="font-medium">Protocol:</span> Codex Responses API</div>}
                        {k.account_id && <div className="min-w-0 break-all"><span className="font-medium">Account ID:</span> <code className="font-mono">{k.account_id}</code></div>}
                        {k.auth_kind === 'oauth' && <div><span className="font-medium">Refresh token:</span> {k.has_refresh_token ? 'stored (never shown)' : 'not stored'}</div>}
                        {k.auth_kind === 'oauth' && <div><span className="font-medium">Expires:</span> {k.expires_at ? formatTime(k.expires_at) : 'unknown'}</div>}
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