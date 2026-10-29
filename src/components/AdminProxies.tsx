import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'
import type { Proxy } from '../lib/types'

type TestResult = { ok: boolean; status: string; latencyMs: number | null; error?: string }

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
  disabled: 'bg-muted',
}

function formatCooldown(ms: number | null): string {
  if (ms == null) return '—'
  const diff = ms - Date.now()
  if (diff <= 0) return 'expired'
  if (diff % 86_400_000 === 0) return `${diff / 86_400_000}d`
  if (diff % 3_600_000 === 0) return `${diff / 3_600_000}h`
  if (diff % 60_000 === 0) return `${diff / 60_000}m`
  return `${Math.round(diff / 1000)}s`
}

export default function AdminProxies() {
  const [proxies, setProxies] = useState<Proxy[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [revealed, setRevealed] = useState<{ id: string; password: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ proxies: Proxy[] }>('/admin/proxies')
      setProxies(data.proxies)
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?next=/admin'
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load proxies.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function testProxy(id: string) {
    setBusy(`test:${id}`)
    setActionError('')
    try {
      const data = await api.post<{ test: TestResult }>(`/admin/proxies/${id}/test`)
      setTestResults((prev) => ({ ...prev, [id]: data.test }))
      await load()
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, status: 'down', latencyMs: null, error: err instanceof ApiError ? err.message : 'Test failed' },
      }))
    } finally {
      setBusy(null)
    }
  }

  async function reveal(id: string) {
    if (!confirm('Reveal proxy password? Make sure nobody is watching.')) return
    setBusy(`reveal:${id}`)
    setActionError('')
    try {
      const data = await api.post<{ password: string }>(`/admin/proxies/${id}/reveal`)
      setRevealed({ id, password: data.password })
      try {
        await navigator.clipboard.writeText(data.password)
      } catch {}
    } catch (err) {
      setActionError(`Reveal failed: ${err instanceof ApiError ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  async function toggle(id: string, enabled: number) {
    setBusy(`toggle:${id}`)
    setActionError('')
    try {
      await api.patch(`/admin/proxies/${id}`, { enabled: enabled ? 0 : 1 })
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update proxy.')
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Delete proxy "${label}"? This cannot be undone.`)) return
    setBusy(`del:${id}`)
    setActionError('')
    try {
      await api.del(`/admin/proxies/${id}`)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete proxy.')
    } finally {
      setBusy(null)
    }
  }

  if (error) {
    return <p className="text-[13px] text-loss">{error}</p>
  }
  if (proxies === null) {
    return <p className="py-8 text-center text-[13px] text-muted" role="status">Loading proxies…</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-content">Proxy pool (global)</h2>
          <p className="mt-1 text-[13px] text-muted">Used only on 429 or blocked/connection failures. Inert if empty. Connect timeout 10s; LLM calls keep full upstream timeout.</p>
        </div>
        <Button size="sm" onClick={() => { setCreating(true); setEditingId(null) }}>Add proxy</Button>
      </div>
      {actionError ? <p className="text-[13px] text-loss">{actionError}</p> : null}
      {creating || editingId ? (
        <ProxyForm
          proxy={editingId ? proxies.find((p) => p.id === editingId) ?? null : null}
          onCancel={() => { setCreating(false); setEditingId(null) }}
          onSaved={async () => { setCreating(false); setEditingId(null); await load() }}
        />
      ) : null}
      {revealed ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-content">Revealed password</p>
            <p className="mt-1 break-all font-mono text-[12px] text-content">{revealed.password}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>Hide</Button>
        </Card>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="px-3 py-2 font-medium">Proxy</th>
              <th className="px-3 py-2 font-medium">URL</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Cooldown</th>
              <th className="px-3 py-2 font-medium">Enabled</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {proxies.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted" colSpan={6}>No proxies configured. Traffic will go direct.</td>
              </tr>
            ) : null}
            {proxies.map((p) => {
              const tr = testResults[p.id]
              return (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-3">
                    <p className="font-medium text-content">{p.label}</p>
                    <p className="text-[12px] text-muted">{p.username ? `user: ${p.username}` : 'no auth'}</p>
                  </td>
                  <td className="px-3 py-3 font-mono text-[12px] text-content">{p.url}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${statusDot[p.status] || 'bg-muted'}`} />
                      <span className="text-content">{p.status}</span>
                    </div>
                    {tr ? <p className="mt-1 text-[12px] text-muted">{tr.ok ? `${tr.latencyMs}ms` : tr.error?.slice(0, 60)}</p> : p.last_error ? <p className="mt-1 text-[12px] text-loss">{p.last_error.slice(0, 60)}</p> : null}
                  </td>
                  <td className="px-3 py-3 text-muted">{formatCooldown(p.cooldown_until)}</td>
                  <td className="px-3 py-3 text-muted">{p.enabled ? 'yes' : 'no'}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => testProxy(p.id)}>{busy === `test:${p.id}` ? 'Testing…' : 'Test'}</Button>
                      {p.has_password ? <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => reveal(p.id)}>{busy === `reveal:${p.id}` ? '…' : 'Reveal'}</Button> : null}
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => toggle(p.id, p.enabled)}>{p.enabled ? 'Disable' : 'Enable'}</Button>
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditingId(p.id)}>Edit</Button>
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => remove(p.id, p.label)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProxyForm({ proxy, onCancel, onSaved }: { proxy: Proxy | null; onCancel: () => void; onSaved: () => Promise<void> | void }) {
  const editing = Boolean(proxy)
  const [label, setLabel] = useState(proxy?.label ?? '')
  const [url, setUrl] = useState(proxy?.url ?? '')
  const [username, setUsername] = useState(proxy?.username ?? '')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr('')
    try {
      if (editing && proxy) {
        await api.patch(`/admin/proxies/${proxy.id}`, {
          label,
          url,
          username: username || null,
          ...(password ? { password } : {}),
        })
      } else {
        await api.post('/admin/proxies', { label, url, username: username || null, password: password || null })
      }
      await onSaved()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to save proxy.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required /></Field>
          <Field label="Proxy URL (host:port or http(s)://)"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="proxy.example.com:8080" required /></Field>
          <Field label="Username (optional)"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
          <Field label={editing ? 'New password (leave blank to keep)' : 'Password (optional)'}><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        </div>
        {err ? <p className="text-[13px] text-loss">{err}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create proxy'}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] text-muted">
      <span>{label}</span>
      {children}
    </label>
  )
}
