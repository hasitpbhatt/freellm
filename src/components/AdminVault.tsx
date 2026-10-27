import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'

type VaultKey = {
  id: string
  username: string
  email: string
  label: string
  base_url: string
  upstream_model: string
  key_masked: string
  status: 'live' | 'slow' | 'down' | 'unknown' | 'disabled'
  last_checked_at: number | null
  messages_served: number
  created_at: number
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

function revealVaultKey(keyId: string): Promise<string> {
  return api.post<{ api_key: string }>(`/admin/vault/${keyId}/reveal`)
    .then((res) => res.api_key)
}

export default function AdminVault() {
  const [keys, setKeys] = useState<VaultKey[] | null>(null)
  const [error, setError] = useState('')
  const [revealingId, setRevealingId] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<{ id: string; label: string; owner: string; key: string } | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ keys: VaultKey[] }>('/admin/vault')
      setKeys(data.keys)
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?next=/admin'
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load the vault.')
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- vault list load on mount
    void load()
  }, [load])

  const handleReveal = async (key: VaultKey) => {
    if (revealedKey && revealedKey.id !== key.id) {
      setToast({ kind: 'err', text: `Close the open reveal for "${revealedKey.label}" first — one secret at a time.` })
      return
    }
    if (!confirm(`Reveal the bearer key of "${key.label}" (@${key.username})? It will be shown on screen — make sure nobody is watching.`)) return
    setRevealingId(key.id)
    try {
      const apiKey = await revealVaultKey(key.id)
      setRevealedKey({ id: key.id, label: key.label, owner: `@${key.username} (${key.email})`, key: apiKey })
    } catch (err) {
      setToast({ kind: 'err', text: `Reveal failed: ${err instanceof ApiError ? err.message : String(err)}` })
    } finally {
      setRevealingId(null)
    }
  }

  const handleCopy = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      setToast({ kind: 'ok', text: 'Copied to clipboard' })
    } catch {
      setToast({ kind: 'err', text: 'Copy failed — select and copy manually' })
    }
  }

  const closeReveal = () => {
    setRevealedKey(null)
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-[13px] text-loss" role="alert">{error}</p>
        <Button onClick={() => void load()} className="mt-4">
          Retry
        </Button>
      </div>
    )
  }
  if (keys === null) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Vault (BYOK)</h1>
        <p className="mt-1 text-[13px] text-muted">
          All user-provided keys across the platform. Keys are encrypted at rest (AES-256-GCM).
          Reveal decrypts one key at a time and shows it inline — every reveal hits the server audit log.
        </p>
      </div>

      {keys.length === 0 && (
        <Card className="p-8 text-center text-[13px] text-muted">
          No BYOK keys stored yet. Keys appear here when users add them on the Keys page.
        </Card>
      )}

      {keys.map((k) => (
        <Card key={k.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`h-2 w-2 rounded-full ${statusDot[k.status]}`} aria-hidden="true" />
              <span className="sr-only">{statusLabel[k.status]}: </span>
              <span className="font-medium">{k.label}</span>
              <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                {statusLabel[k.status]}
              </span>
            </div>
            <dl className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
              <div><dt className="sr-only">Masked key</dt><dd className="num font-mono">{k.key_masked}</dd></div>
              <div><dt className="sr-only">Owner</dt><dd>@{k.username} · {k.email}</dd></div>
              <div><dt className="sr-only">Endpoint</dt><dd>{k.base_url}</dd></div>
              <div><dt className="sr-only">Upstream model</dt><dd className="font-mono">{k.upstream_model}</dd></div>
              <div><dt className="sr-only">Messages served</dt><dd>Served: {k.messages_served}</dd></div>
              <div><dt className="sr-only">Added</dt><dd>Added: {formatTime(k.created_at)}</dd></div>
              <div><dt className="sr-only">Last checked</dt><dd>Last checked: {formatTime(k.last_checked_at)}</dd></div>
            </dl>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => handleReveal(k)}
              disabled={revealingId !== null}
              className="text-accent"
            >
              {revealingId === k.id ? 'Revealing…' : 'Reveal'}
            </Button>
          </div>
        </Card>
      ))}

      {/* Reveal modal */}
      {revealedKey && (
        <div className="modal-overlay" onClick={closeReveal}>
          <Card className="modal-content" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Revealed key for ${revealedKey.label}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Key revealed — "{revealedKey.label}" ({revealedKey.owner})</h3>
              <button onClick={closeReveal} className="text-muted hover:text-content text-2xl leading-none" aria-label="Close reveal dialog">×</button>
            </div>
            <div className="relative mb-4">
              <label className="sr-only" htmlFor="revealed-key-value">Revealed bearer key</label>
              <textarea
                id="revealed-key-value"
                readOnly
                onFocus={(e) => e.target.select()}
                className="input w-full font-mono text-[12px] min-h-[60px] pr-20"
                value={revealedKey.key}
              />
              <Button
                variant="secondary"
                size="sm"
                className="absolute right-2 bottom-2"
                onClick={() => handleCopy(revealedKey.key)}
              >
                Copy
              </Button>
            </div>
            <p className="text-[12px] text-muted">
              Decrypted on demand for this viewing. Copying puts it in your system clipboard — clear
              the clipboard after use. Closing hides it again.
            </p>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={closeReveal}>Done</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container" role={toast.kind === 'err' ? 'alert' : 'status'}>
          <Card className={`border-${toast.kind === 'ok' ? 'gain' : 'loss'} max-w-sm`}>
            <p className="p-3 text-[13px]">{toast.kind === 'ok' ? '✓ ' : '⚠ '}{toast.text}</p>
          </Card>
        </div>
      )}
    </div>
  )
}