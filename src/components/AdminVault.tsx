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
  const [revealedKey, setRevealedKey] = useState<{ id: string; key: string } | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

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
    void load()
  }, [load])

  const handleReveal = async (keyId: string) => {
    setRevealingId(keyId)
    try {
      const key = await revealVaultKey(keyId)
      setRevealedKey({ id: keyId, key })
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

  if (error) return <p className="py-12 text-center text-[13px] text-loss">{error}</p>
  if (keys === null) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Vault (BYOK)</h1>
        <p className="mt-1 text-[13px] text-muted">
          All user-provided keys across the platform. Keys are encrypted at rest (AES-256-GCM).
          Reveal decrypts the key and shows it inline — audit trail implied.
        </p>
      </div>

      {keys.length === 0 && (
        <Card className="p-8 text-center text-[13px] text-muted">
          No BYOK keys stored yet.
        </Card>
      )}

      {keys.map((k) => (
        <Card key={k.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`h-2 w-2 rounded-full ${statusDot[k.status]}`} />
              <span className="font-medium">{k.label}</span>
              <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                {statusLabel[k.status]}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 text-[12px] text-muted">
              <span className="num font-mono">{k.key_masked}</span>
              <span>@{k.username}</span>
              <span>{k.email}</span>
              <span>{k.base_url}</span>
              <span className="font-mono">{k.upstream_model}</span>
              <span>Served: {k.messages_served}</span>
              <span>Added: {formatTime(k.created_at)}</span>
              {k.last_checked_at && <span>Last checked: {formatTime(k.last_checked_at)}</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => handleReveal(k.id)}
              disabled={revealingId === k.id}
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
          <Card className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Key revealed — {revealedKey.id.slice(0, 8)}…</h3>
              <button onClick={closeReveal} className="text-muted hover:text-content text-2xl leading-none">×</button>
            </div>
            <div className="relative mb-4">
              <textarea
                readOnly
                className="input w-full font-mono text-[12px] min-h-[60px]"
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
              This key is decrypted on demand. Close this dialog when done — it will not be stored.
            </p>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" onClick={closeReveal}>Done</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <Card className={`border-${toast.kind === 'ok' ? 'gain' : 'loss'} max-w-sm`}>
            <p className="p-3 text-[13px]">{toast.text}</p>
          </Card>
        </div>
      )}
    </div>
  )
}