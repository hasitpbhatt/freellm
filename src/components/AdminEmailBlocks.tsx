import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'

type Block = {
  id: string
  pattern: string
  created_by: string | null
  created_at: number
}

// Operator control: regex blocklist for sign-ups. Each pattern is a JS
// RegExp tested against the lowercased email at Google-OAuth time — a
// match rejects the sign-in before any account exists.
export default function AdminEmailBlocks() {
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [error, setError] = useState('')
  const [pattern, setPattern] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ blocks: Block[] }>('/admin/email-blocks')
      setBlocks(data.blocks)
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?next=/admin'
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load block rules.')
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- block-rule list load on mount
    void load()
  }, [load])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = pattern.trim()
    if (!value) {
      setFormError('Enter a pattern first.')
      return
    }
    try {
      // Client-side validity so a typo fails here, not on the server.
      // eslint-disable-next-line no-new
      new RegExp(value)
    } catch {
      setFormError('That is not a valid regular expression.')
      return
    }
    setBusy(true)
    setFormError('')
    setMessage(null)
    try {
      await api.post('/admin/email-blocks', { pattern: value })
      setPattern('')
      setMessage({ kind: 'ok', text: `Blocked ${value} — matching emails can no longer sign in.` })
      await load()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'Failed to add block rule.' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(block: Block) {
    if (!confirm(`Unblock ${block.pattern}? Those emails will be able to sign in again.`)) return
    try {
      await api.del(`/admin/email-blocks/${block.id}`)
      setMessage({ kind: 'ok', text: `Unblocked ${block.pattern}.` })
      await load()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'Failed to remove block rule.' })
    }
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
  if (blocks === null) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Email blocks</h1>
        <p className="mt-1 text-[13px] text-muted">
          {blocks.length} rule{blocks.length === 1 ? '' : 's'} · regexes matched against the lowercased
          email at sign-in — a match rejects new and returning sign-ins alike.
        </p>
      </div>

      <Card>
        <form className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end" onSubmit={submit}>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-[12px] font-medium uppercase tracking-wide text-muted">
              Regex — matched against the lowercased email
            </span>
            <input
              className="input num"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder=".*@spam\.com$"
              maxLength={200}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
          <Button type="submit" disabled={busy || pattern.trim() === ''}>
            {busy ? 'Adding…' : 'Block pattern'}
          </Button>
        </form>
        {formError && (
          <p role="alert" className="px-4 pb-4 text-[13px] text-loss">{formError}</p>
        )}
        <p className="px-4 pb-4 text-[12px] text-muted">
          Examples: <code className="num">.*@spam\.com$</code> blocks a domain ·{' '}
          <code className="num">^test.*</code> blocks a prefix ·{' '}
          <code className="num">^.*\+spam@</code> blocks plus-addressed spam. Keep them
          simple — tested in order, first match wins.
        </p>
      </Card>

      {message && (
        <p role={message.kind === 'err' ? 'alert' : 'status'} className={`text-[13px] ${message.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
          {message.text}
        </p>
      )}

      {blocks.length === 0 ? (
        <Card className="p-8 text-center text-[13px] text-muted">
          No block rules — every Google email can sign in.
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col divide-y divide-line">
            {blocks.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <code className="num min-w-0 flex-1 break-all text-[13px]">{b.pattern}</code>
                <span className="num shrink-0 text-[12px] text-muted" title={new Date(b.created_at).toLocaleString()}>
                  added {new Date(b.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
                <Button variant="secondary" size="sm" className="text-loss hover:bg-loss/10" onClick={() => void remove(b)}>
                  Unblock
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
