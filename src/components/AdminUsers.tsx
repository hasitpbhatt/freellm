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
    void load()
  }, [load])

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
          Grant tiers inline to unlock locked aliases.
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
          <div className="hidden grid-cols-[3rem_1fr_7rem_7rem_7rem_8rem] items-center gap-3 border-b border-line px-4 py-2 text-[11px] uppercase tracking-wide text-muted sm:grid">
            <span>#</span>
            <span>User</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Earned</span>
            <span className="text-right">Spent</span>
            <span>Tier</span>
          </div>
          <div className="flex flex-col divide-y divide-line">
            {visible.map((u, index) => (
              <div key={u.id} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[3rem_1fr_7rem_7rem_7rem_8rem] sm:items-center sm:gap-3">
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
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
