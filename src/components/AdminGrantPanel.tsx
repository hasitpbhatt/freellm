import { Button, Card, Input, Select } from './ui'

type BoardUser = {
  id: string
  email: string
  username: string
  tier: 'free' | 'pro' | 'enterprise'
  role: string
  balance_credits: number
  email_verified: number
  referral_code: string
  created_at: number
  spent: number
  earned: number
}

type AdminGrant = {
  id: string
  user_id: string
  credits: number
  expires_at: number | null
  expired_at: number | null
  note: string | null
  created_by: string | null
  created_at: number
}

type ExpiryPreset = 'none' | '24h' | '7d' | '30d' | 'custom'

const EXPIRY_PRESETS: { value: ExpiryPreset; label: string }[] = [
  { value: 'none', label: 'No expiry' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'custom', label: 'Custom…' },
]

function grantStatus(g: AdminGrant, nowMs: number): string {
  if (g.expired_at != null) return 'clawed back'
  if (g.expires_at == null) return 'no expiry'
  if (g.expires_at <= nowMs) return 'expired — sweeps on next balance read'
  const ms = g.expires_at - nowMs
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 48) return `${hours}h left`
  return `${Math.floor(hours / 24)}d left`
}

interface AdminGrantPanelProps {
  user: BoardUser
  grantCredits: string
  setGrantCredits: (v: string) => void
  grantPreset: ExpiryPreset
  setGrantPreset: (v: ExpiryPreset) => void
  grantCustom: string
  setGrantCustom: (v: string) => void
  grantNote: string
  setGrantNote: (v: string) => void
  grantMsg: string
  grantBusy: boolean
  grantsLoading: boolean
  grants: Record<string, AdminGrant[]>
  onClose: () => void
  onSubmit: (user: BoardUser) => void
}

export function AdminGrantPanel({
  user,
  grantCredits,
  setGrantCredits,
  grantPreset,
  setGrantPreset,
  grantCustom,
  setGrantCustom,
  grantNote,
  setGrantNote,
  grantMsg,
  grantBusy,
  grantsLoading,
  grants,
  onClose,
  onSubmit,
}: AdminGrantPanelProps) {
  const userGrants = grants[user.id] ?? []

  return (
    <Card className="border-warn/30 bg-warn/5">
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-medium">{user.email}</p>
            <p className="text-sm text-muted">@{user.username}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-[10rem_10rem_10rem_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Credits</span>
            <Input
              className="num"
              value={grantCredits}
              onChange={(e) => setGrantCredits(e.target.value)}
              inputMode="numeric"
              placeholder="50000"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Timer</span>
            <Select
              value={grantPreset}
              onChange={(v) => setGrantPreset(v as ExpiryPreset)}
              options={EXPIRY_PRESETS}
              className="input"
            />
          </label>
          {grantPreset === 'custom' ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">Expires at</span>
              <Input
                className="input"
                type="datetime-local"
                value={grantCustom}
                onChange={(e) => setGrantCustom(e.target.value)}
              />
            </label>
          ) : (
            <p className="text-xs text-muted">
              {grantPreset === 'none' ? 'Stays until spent.' : 'Unspent credits return automatically when the timer ends.'}
            </p>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted">Note (optional)</span>
            <Input
              value={grantNote}
              onChange={(e) => setGrantNote(e.target.value)}
              placeholder="contest winner"
              maxLength={300}
            />
          </label>
          <Button onClick={() => void onSubmit(user)} disabled={grantBusy}>
            {grantBusy ? 'Granting…' : 'Confirm grant'}
          </Button>
        </div>
        {grantMsg && <p role="status" className="mt-2 text-sm text-gain">{grantMsg}</p>}
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Past grants</p>
          {grantsLoading && userGrants.length === 0 ? (
            <p className="mt-1 text-xs text-muted">Loading…</p>
          ) : userGrants.length === 0 ? (
            <p className="mt-1 text-xs text-muted">No one-off grants yet.</p>
          ) : (
            <ul className="mt-1 flex flex-col divide-y divide-line">
              {userGrants.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
                  <span className="num font-medium text-gain">+{g.credits.toLocaleString('en-US')}</span>
                  <span className="num text-muted">{grantStatus(g, Date.now())}</span>
                  {g.expires_at != null && (
                    <span className="num text-muted" title={new Date(g.expires_at).toLocaleString()}>
                      → {new Date(g.expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {g.note && <span className="text-muted">"{g.note}"</span>}
                  <span className="num ml-auto text-muted" title={new Date(g.created_at).toLocaleString()}>
                    {new Date(g.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}