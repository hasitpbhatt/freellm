import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'

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

type SortKey = 'balance' | 'earned' | 'spent' | 'newest'

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

const EXPIRY_PRESETS: { id: ExpiryPreset; label: string }[] = [
  { id: 'none', label: 'No expiry' },
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'custom', label: 'Custom…' },
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

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'balance', label: 'Balance' },
  { id: 'earned', label: 'Earned' },
  { id: 'spent', label: 'Spent' },
  { id: 'newest', label: 'Newest' },
]

// Operator board: every signed-up user with token balances, ranked.
// Tiers are granted inline — the other half of locking premium aliases.
export default function AdminUsers() {
  const [users, setUsers] = useState<BoardUser[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('balance')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState('')
  const [grantFor, setGrantFor] = useState<string | null>(null)
  const [grantCredits, setGrantCredits] = useState('50000')
  const [grantPreset, setGrantPreset] = useState<ExpiryPreset>('none')
  const [grantCustom, setGrantCustom] = useState('')
  const [grantNote, setGrantNote] = useState('')
  const [grantBusy, setGrantBusy] = useState(false)
  const [grantMsg, setGrantMsg] = useState('')
  const [grants, setGrants] = useState<Record<string, AdminGrant[]>>({})
  const [grantsLoading, setGrantsLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ users: BoardUser[] }>('/admin/users?limit=500')
      setUsers(data.users)
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?next=/admin'
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load users.')
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- user board load on mount
    void load()
  }, [load])

  async function loadGrants(userId: string) {
    setGrantsLoading(true)
    try {
      const data = await api.get<{ grants: AdminGrant[] }>(`/admin/users/${userId}/grants`)
      setGrants((prev) => ({ ...prev, [userId]: data.grants }))
    } catch {
      // History is advisory — the grant form still works without it.
    } finally {
      setGrantsLoading(false)
    }
  }

  function openGrantPanel(user: BoardUser) {
    setGrantFor(user.id)
    setGrantCredits('50000')
    setGrantPreset('none')
    setGrantCustom('')
    setGrantNote('')
    setGrantMsg('')
    setRowError('')
    if (grants[user.id] === undefined) void loadGrants(user.id)
  }

  function grantExpiresAt(): number | null {
    if (grantPreset === 'none') return null
    if (grantPreset === '24h') return Date.now() + 24 * 3_600_000
    if (grantPreset === '7d') return Date.now() + 7 * 24 * 3_600_000
    if (grantPreset === '30d') return Date.now() + 30 * 24 * 3_600_000
    if (!grantCustom) return null
    return new Date(grantCustom).getTime()
  }

  async function submitGrant(user: BoardUser) {
    const credits = Number(grantCredits)
    if (!Number.isInteger(credits) || credits <= 0 || credits > 10_000_000) {
      setRowError('Credits must be an integer 1–10,000,000.')
      return
    }
    const expiresAt = grantExpiresAt()
    if (grantPreset === 'custom' && (expiresAt == null || !Number.isFinite(expiresAt))) {
      setRowError('Pick a custom expiry date first.')
      return
    }
    if (expiresAt != null && expiresAt <= Date.now()) {
      setRowError('Expiry must be in the future.')
      return
    }
    const expiryLabel = expiresAt == null
      ? 'never expires'
      : `expires ${new Date(expiresAt).toLocaleString()}`
    if (!confirm(`Grant ${credits.toLocaleString('en-US')} cr to ${user.email} (@${user.username})? One-off, added to their balance — ${expiryLabel}.`)) return
    setGrantBusy(true)
    setRowError('')
    try {
      const data = await api.post<{ grant: AdminGrant; balance_credits: number }>(`/admin/users/${user.id}/grant`, {
        credits,
        expires_at: expiresAt,
        note: grantNote.trim() || undefined,
      })
      setUsers((prev) => prev?.map((u) => (u.id === user.id ? { ...u, balance_credits: data.balance_credits, earned: u.earned + credits } : u)) ?? prev)
      setGrants((prev) => ({ ...prev, [user.id]: [data.grant, ...(prev[user.id] ?? [])] }))
      setGrantMsg(`Granted ${credits.toLocaleString('en-US')} cr — ${expiryLabel}.`)
      setGrantCredits('50000')
      setGrantNote('')
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to grant credits.')
    } finally {
      setGrantBusy(false)
    }
  }

  async function setTier(user: BoardUser, tier: BoardUser['tier']) {
    if (tier === user.tier) return
    // Upgrades unlock paid aliases — confirm so a fat-finger slip on a
    // touch select can't silently grant pro/enterprise.
    const rank = { free: 0, pro: 1, enterprise: 2 } as const
    if (rank[tier] > rank[user.tier]) {
      if (!confirm(`Grant ${tier} tier to ${user.email} (@${user.username})? This unlocks locked models for them.`)) return
    }
    setSavingId(user.id)
    setRowError('')
    try {
      await api.patch(`/admin/users/${user.id}`, { tier })
      setUsers((prev) => prev?.map((u) => (u.id === user.id ? { ...u, tier } : u)) ?? prev)
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : 'Failed to update tier.')
    } finally {
      setSavingId(null)
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = (users ?? []).filter(
      (u) => !q || u.email.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
    )
    const by: Record<SortKey, (a: BoardUser, b: BoardUser) => number> = {
      balance: (a, b) => b.balance_credits - a.balance_credits,
      earned: (a, b) => b.earned - a.earned,
      spent: (a, b) => b.spent - a.spent,
      newest: (a, b) => b.created_at - a.created_at,
    }
    return [...filtered].sort(by[sort])
  }, [users, query, sort])

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
  if (users === null) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  const totals = users.reduce(
    (acc, u) => ({ balance: acc.balance + u.balance_credits, earned: acc.earned + u.earned, spent: acc.spent + u.spent }),
    { balance: 0, earned: 0, spent: 0 },
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="mt-1 text-[13px] text-muted">
          {users.length} signed up · {totals.balance.toLocaleString('en-US')} cr held ·{' '}
          {totals.earned.toLocaleString('en-US')} earned · {totals.spent.toLocaleString('en-US')} spent.
          Grant tiers inline to unlock locked aliases, or push one-off credit grants (optionally timed) per user.
        </p>
      </div>

      <div className="sticky top-[48px] z-[5] -mx-1 bg-bg/95 px-1 py-2 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="user-search">Search users</label>
        <input
          id="user-search"
          className="input max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search email or username…"
        />
        <label className="flex min-h-[44px] items-center gap-2 text-[13px] text-muted">
          Rank by
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
        <span className="num ml-auto text-[12px] text-muted" role="status">
          Showing {visible.length} of {users.length}
        </span>
      </div>
      </div>

      {rowError && <p role="alert" className="text-[13px] text-loss">{rowError}</p>}

      {visible.length === 0 ? (
        <Card className="p-8 text-center text-[13px] text-muted">
          {query ? `No users match "${query}".` : 'No users yet.'}
        </Card>
      ) : (
        <Card>
          <div className="hidden grid-cols-[3rem_1fr_7rem_7rem_7rem_8rem_5rem] items-center gap-3 border-b border-line px-4 py-2 text-[11px] uppercase tracking-wide text-muted sm:grid">
            <span>#</span>
            <span>User</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Earned</span>
            <span className="text-right">Spent</span>
            <span>Tier</span>
            <span className="text-right">Grant</span>
          </div>
          <div className="flex flex-col divide-y divide-line">
            {visible.map((u, index) => (
              <div key={u.id}>
              <div className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[3rem_1fr_7rem_7rem_7rem_8rem_5rem] sm:items-center sm:gap-3">
                <span className="num text-[13px] text-muted">{index + 1}</span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-medium">
                    {u.email}
                    {u.role === 'admin' && (
                      <span className="ml-1.5 rounded bg-accent/10 px-1 py-0.5 text-[10px] font-medium text-accent">admin</span>
                    )}
                    {u.email_verified !== 1 && (
                      <span className="ml-1.5 rounded bg-warn/10 px-1 py-0.5 text-[10px] font-medium text-warn">unverified</span>
                    )}
                  </span>
                  <span className="num truncate text-[12px] text-muted">
                    @{u.username} · joined {new Date(u.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                </div>
                <span className="num text-left text-[13px] sm:text-right" title="Spendable global balance">{u.balance_credits.toLocaleString('en-US')}</span>
                <span className="num text-left text-[12px] text-gain sm:text-right" title="Lifetime credits granted">+{u.earned.toLocaleString('en-US')}</span>
                <span className="num text-left text-[12px] text-muted sm:text-right" title="Lifetime pool spend incl. scoped grants">{u.spent.toLocaleString('en-US')}</span>
                <label className="flex min-h-[44px] items-center gap-2">
                  <span className="sr-only">Tier for {u.email}</span>
                  <select
                    className="input"
                    value={u.tier}
                    disabled={savingId === u.id}
                    onChange={(e) => void setTier(u, e.target.value as BoardUser['tier'])}
                    title={savingId === u.id ? 'Saving…' : `Grant tier to ${u.email}`}
                    aria-busy={savingId === u.id}
                  >
                    <option value="free">free</option>
                    <option value="pro">pro</option>
                    <option value="enterprise">enterprise</option>
                  </select>
                  {savingId === u.id && (
                    <span className="num text-[12px] text-muted" role="status">Saving…</span>
                  )}
                </label>
                <div className="sm:text-right">
                  <Button
                    variant="ghost"
                    onClick={() => (grantFor === u.id ? setGrantFor(null) : openGrantPanel(u))}
                    title={`One-off credit grant to ${u.email}`}
                  >
                    {grantFor === u.id ? 'Close' : 'Grant'}
                  </Button>
                </div>
              </div>
              {grantFor === u.id && (
                <div className="border-t border-line bg-surface-1 px-4 py-3">
                  <div className="grid gap-3 sm:grid-cols-[10rem_10rem_10rem_1fr_auto] sm:items-end">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Credits</span>
                      <input
                        className="input num"
                        value={grantCredits}
                        onChange={(e) => setGrantCredits(e.target.value)}
                        inputMode="numeric"
                        placeholder="50000"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Timer</span>
                      <select className="input" value={grantPreset} onChange={(e) => setGrantPreset(e.target.value as ExpiryPreset)}>
                        {EXPIRY_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </label>
                    {grantPreset === 'custom' ? (
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Expires at</span>
                        <input
                          className="input"
                          type="datetime-local"
                          value={grantCustom}
                          onChange={(e) => setGrantCustom(e.target.value)}
                        />
                      </label>
                    ) : (
                      <p className="text-[12px] text-muted">
                        {grantPreset === 'none'
                          ? 'Stays until spent.'
                          : 'Unspent credits return automatically when the timer ends.'}
                      </p>
                    )}
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Note (optional)</span>
                      <input
                        className="input"
                        value={grantNote}
                        onChange={(e) => setGrantNote(e.target.value)}
                        placeholder="contest winner"
                        maxLength={300}
                      />
                    </label>
                    <Button onClick={() => void submitGrant(u)} disabled={grantBusy}>
                      {grantBusy ? 'Granting…' : 'Confirm grant'}
                    </Button>
                  </div>
                  {grantMsg && <p role="status" className="mt-2 text-[13px] text-gain">{grantMsg}</p>}
                  <div className="mt-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Past grants</p>
                    {grantsLoading && grants[u.id] === undefined ? (
                      <p className="mt-1 text-[12px] text-muted">Loading…</p>
                    ) : (grants[u.id] ?? []).length === 0 ? (
                      <p className="mt-1 text-[12px] text-muted">No one-off grants yet.</p>
                    ) : (
                      <ul className="mt-1 flex flex-col divide-y divide-line">
                        {(grants[u.id] ?? []).map((g) => (
                          <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-[12px]">
                            <span className="num font-medium text-gain">+{g.credits.toLocaleString('en-US')}</span>
                            <span className="num text-muted">{grantStatus(g, Date.now())}</span>
                            {g.expires_at != null && (
                              <span className="num text-muted" title={new Date(g.expires_at).toLocaleString()}>
                                → {new Date(g.expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                              </span>
                            )}
                            {g.note && <span className="text-muted">“{g.note}”</span>}
                            <span className="num ml-auto text-muted" title={new Date(g.created_at).toLocaleString()}>
                              {new Date(g.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
