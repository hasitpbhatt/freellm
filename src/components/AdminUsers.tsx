import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../lib/api'
import {
  Button,
  Card,
  Input,
  Select,
  VirtualizedTable,
  FilterChipBar,
  useConfirm,
  useToast,
  SparklinePlus,
  type ColumnDef,
  type FilterChip,
} from './ui'
import { AdminGrantPanel } from './AdminGrantPanel'
import { formatCredits } from '../lib/format'

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

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'balance', label: 'Balance' },
  { value: 'earned', label: 'Earned' },
  { value: 'spent', label: 'Spent' },
  { value: 'newest', label: 'Newest' },
]

const TIER_FILTERS: FilterChip[] = [
  { key: 'free', label: 'Free', value: 'free' },
  { key: 'pro', label: 'Pro', value: 'pro' },
  { key: 'enterprise', label: 'Enterprise', value: 'enterprise' },
]

const VERIFIED_FILTERS: FilterChip[] = [
  { key: 'verified', label: 'Verified', value: 'verified' },
  { key: 'unverified', label: 'Unverified', value: 'unverified' },
]

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
  const [tierFilters, setTierFilters] = useState<string[]>([])
  const [verifiedFilters, setVerifiedFilters] = useState<string[]>([])
  const [dailyUsage, setDailyUsage] = useState<Record<string, { day: string; value: number }[]>>({})

  const { confirm } = useConfirm()
  const { addToast } = useToast()

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
      addToast({ type: 'error', title: 'Failed to load users', message: err instanceof ApiError ? err.message : 'Unknown error' })
    }
  }, [addToast])

  useEffect(() => {
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

  function submitGrant(user: BoardUser) {
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

    confirm({
      title: 'Confirm credit grant',
      message: `Grant ${credits.toLocaleString('en-US')} cr to ${user.email} (@${user.username})? One-off, added to their balance — ${expiresAt == null ? 'never expires' : `expires ${new Date(expiresAt).toLocaleString()}`}.`,
      onConfirm: () => {
        setGrantBusy(true)
        setRowError('')
        void (async () => {
          try {
            const data = await api.post<{ grant: AdminGrant; balance_credits: number }>(`/admin/users/${user.id}/grant`, {
              credits,
              expires_at: expiresAt,
              note: grantNote.trim() || undefined,
            })
            setUsers((prev) =>
              prev?.map((u) => (u.id === user.id ? { ...u, balance_credits: data.balance_credits, earned: u.earned + credits } : u)) ?? prev,
            )
            setGrants((prev) => ({ ...prev, [user.id]: [data.grant, ...(prev[user.id] ?? [])] }))
            setGrantMsg(`Granted ${credits.toLocaleString('en-US')} cr — ${expiresAt == null ? 'never expires' : `expires ${new Date(expiresAt).toLocaleString()}`}.`)
            setGrantCredits('50000')
            setGrantNote('')
            addToast({ type: 'success', title: 'Grant successful', message: `${credits.toLocaleString('en-US')} cr granted to ${user.email}` })
          } catch (err) {
            setRowError(err instanceof ApiError ? err.message : 'Failed to grant credits.')
            addToast({ type: 'error', title: 'Grant failed', message: err instanceof ApiError ? err.message : 'Unknown error' })
          } finally {
            setGrantBusy(false)
          }
        })()
      },
    })
  }

  function handleSetTier(user: BoardUser, tier: BoardUser['tier']) {
    if (tier === user.tier) return
    const rank = { free: 0, pro: 1, enterprise: 2 } as const
    const doUpdate = () => {
      setSavingId(user.id)
      setRowError('')
      void (async () => {
        try {
          await api.patch(`/admin/users/${user.id}`, { tier })
          setUsers((prev) => prev?.map((u) => (u.id === user.id ? { ...u, tier } : u)) ?? prev)
          addToast({ type: 'success', title: 'Tier updated', message: `${user.email} changed to ${tier}` })
        } catch (err) {
          setRowError(err instanceof ApiError ? err.message : 'Failed to update tier.')
          addToast({ type: 'error', title: 'Tier update failed', message: err instanceof ApiError ? err.message : 'Unknown error' })
        } finally {
          setSavingId(null)
        }
      })()
    }

    if (rank[tier] > rank[user.tier]) {
      confirm({
        title: 'Grant tier upgrade',
        message: `Grant ${tier} tier to ${user.email} (@${user.username})? This unlocks locked models for them.`,
        variant: 'primary',
        onConfirm: doUpdate,
      })
    } else {
      doUpdate()
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let filtered = (users ?? []).filter(
      (u) => !q || u.email.toLowerCase().includes(q) || u.username.toLowerCase().includes(q),
    )
    if (tierFilters.length > 0) {
      filtered = filtered.filter((u) => tierFilters.includes(u.tier))
    }
    if (verifiedFilters.length > 0) {
      filtered = filtered.filter((u) => {
        if (verifiedFilters.includes('verified') && u.email_verified === 1) return true
        if (verifiedFilters.includes('unverified') && u.email_verified !== 1) return true
        return false
      })
    }
    const by: Record<SortKey, (a: BoardUser, b: BoardUser) => number> = {
      balance: (a, b) => b.balance_credits - a.balance_credits,
      earned: (a, b) => b.earned - a.earned,
      spent: (a, b) => b.spent - a.spent,
      newest: (a, b) => b.created_at - a.created_at,
    }
    return [...filtered].sort(by[sort])
  }, [users, query, sort, tierFilters, verifiedFilters])

  // Load daily usage lazily for visible users
  useEffect(() => {
    const visibleUserIds = visible.map((u) => u.id)
    visibleUserIds.forEach((id) => {
      if (dailyUsage[id] === undefined) {
        void (async () => {
          try {
            const data = await api.get<{ user_id: string; daily: { day: string; value: number }[] }>(
              `/admin/users/${id}/usage-daily`,
            )
            setDailyUsage((prev) => ({ ...prev, [id]: data.daily }))
          } catch {
            // Daily usage is advisory
          }
        })()
      }
    })
  }, [visible, dailyUsage])

  // --- Memoized derived state (must be before any early returns) ---
const columns: ColumnDef<BoardUser>[] = useMemo(
    () => [
      {
        key: 'rank',
        header: '#',
        width: '3rem',
        align: 'right',
        render: (_, index) => <span className="num text-sm text-muted">{index + 1}</span>,
      },
      {
        key: 'user',
        header: 'User',
        minWidth: '200px',
        render: (u) => (
          <div className="flex flex-col min-w-0">
            <span className="truncate text-sm font-medium">
              {u.email}
              {u.role === 'admin' && (
                <span className="ml-1.5 rounded bg-accent/10 px-1 py-0.5 text-2xs font-medium text-accent">admin</span>
              )}
              {u.email_verified !== 1 && (
                <span className="ml-1.5 rounded bg-warn/10 px-1 py-0.5 text-2xs font-medium text-warn">unverified</span>
              )}
            </span>
            <span className="num truncate text-xs text-muted">
              @{u.username} · joined {new Date(u.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
            </span>
          </div>
        ),
      },
      {
        key: 'balance',
        header: 'Balance',
        width: '7rem',
        align: 'right',
        render: (u) => <span className="num text-sm" title="Spendable global balance">{u.balance_credits.toLocaleString('en-US')}</span>,
      },
      {
        key: 'earned',
        header: 'Earned',
        width: '7rem',
        align: 'right',
        render: (u) => <span className="num text-xs text-gain" title="Lifetime credits granted">+{u.earned.toLocaleString('en-US')}</span>,
      },
      {
        key: 'spent',
        header: 'Spent',
        width: '7rem',
        align: 'right',
        render: (u) => <span className="num text-xs text-muted" title="Lifetime pool spend incl. scoped grants">{u.spent.toLocaleString('en-US')}</span>,
      },
      {
        key: 'tier',
        header: 'Tier',
        width: '8rem',
        render: (u) => (
          <label className="flex min-h-[44px] items-center gap-2">
            <span className="sr-only">Tier for {u.email}</span>
            <Select
              value={u.tier}
              onChange={(v) => void handleSetTier(u, v as BoardUser['tier'])}
              options={[
                { value: 'free', label: 'free' },
                { value: 'pro', label: 'pro' },
                { value: 'enterprise', label: 'enterprise' },
              ]}
              disabled={savingId === u.id}
              className="input"
              aria-busy={savingId === u.id}
            />
            {savingId === u.id && <span className="num text-xs text-muted" role="status">Saving…</span>}
          </label>
        ),
      },
      {
        key: 'grant',
        header: 'Grant',
        width: '5rem',
        align: 'right',
        render: (u) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => (grantFor === u.id ? setGrantFor(null) : openGrantPanel(u))}
            title={`One-off credit grant to ${u.email}`}
          >
            {grantFor === u.id ? 'Close' : 'Grant'}
          </Button>
        ),
      },
      {
        key: 'sparkline',
        header: 'Daily (14d)',
        minWidth: '180px',
        render: (u) => {
          const daily = dailyUsage[u.id] ?? []
          return daily.length > 0 ? (
            <SparklinePlus
              data={daily}
              width={170}
              height={36}
              color="var(--accent)"
              showTooltip={true}
              tooltipFormatter={(v) => `${v.toLocaleString('en-US')} cr`}
            />
          ) : (
            <span className="text-xs text-muted">Loading…</span>
          )
        },
      },
    ],
    [savingId, grantFor, dailyUsage]
  )

const tierFilterChips: FilterChip[] = useMemo(
    () =>
      TIER_FILTERS.map((f) => ({
        ...f,
        count: users?.filter((u) => u.tier === f.value).length ?? 0,
      })),
    [users]
  )

const verifiedFilterChips: FilterChip[] = useMemo(
    () =>
      VERIFIED_FILTERS.map((f) => ({
        ...f,
        count: users?.filter((u) => (f.value === 'verified' ? u.email_verified === 1 : u.email_verified !== 1)).length ?? 0,
      })),
    [users]
  )


  if (error) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-sm text-loss" role="alert">{error}</p>
        <Button onClick={() => void load()} className="mt-4">
          Retry
        </Button>
      </div>
    )
  }
  if (users === null) return <p className="py-12 text-center text-sm text-muted">Loading…</p>

  const totals = users.reduce(
    (acc, u) => ({ balance: acc.balance + u.balance_credits, earned: acc.earned + u.earned, spent: acc.spent + u.spent }),
    { balance: 0, earned: 0, spent: 0 },
  )

  // Find the user for the grant panel
  const grantUser = users?.find((user) => user.id === grantFor)

  

  

  

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="mt-1 text-sm text-muted">
          {users.length} signed up · {formatCredits(totals.balance)} cr held ·{' '}
          {formatCredits(totals.earned)} earned · {formatCredits(totals.spent)} spent.
          Grant tiers inline to unlock locked aliases, or push one-off credit grants (optionally timed) per user.
        </p>
      </div>

      <div className="sticky top-[48px] z-[5] -mx-1 bg-bg/95 px-1 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="user-search">Search users</label>
          <Input
            id="user-search"
            className="max-w-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search email or username…"
          />
          <FilterChipBar
            filters={tierFilterChips}
            activeKeys={tierFilters}
            onChange={setTierFilters}
            multiple
            className="hidden sm:flex"
          />
          <FilterChipBar
            filters={verifiedFilterChips}
            activeKeys={verifiedFilters}
            onChange={setVerifiedFilters}
            multiple
            className="hidden sm:flex"
          />
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-muted">
            Rank by
            <Select
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              options={SORTS}
              className="input"
            />
          </label>
          <span className="num ml-auto text-xs text-muted" role="status">
            Showing {visible.length} of {users.length}
          </span>
        </div>
      </div>

      {rowError && <p role="alert" className="text-sm text-loss">{rowError}</p>}

      {visible.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">
          {query ? `No users match "${query}".` : tierFilters.length > 0 || verifiedFilters.length > 0 ? 'No users match current filters.' : 'No users yet.'}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <VirtualizedTable
            columns={columns}
            data={visible}
            rowKey={(u) => u.id}
            height={600}
            rowHeight={88}
            overscan={5}
            emptyMessage={query ? `No users match "${query}".` : 'No users yet.'}
            sortBy={sort}
            sortDir="desc"
            onSort={(key) => setSort(key as SortKey)}
          />
        </Card>
      )}

      {/* Grant panel - renders at bottom for selected user */}
      {grantFor && grantUser && (
        <AdminGrantPanel
          user={grantUser}
          grantCredits={grantCredits}
          setGrantCredits={setGrantCredits}
          grantPreset={grantPreset}
          setGrantPreset={setGrantPreset}
          grantCustom={grantCustom}
          setGrantCustom={setGrantCustom}
          grantNote={grantNote}
          setGrantNote={setGrantNote}
          grantMsg={grantMsg}
          grantBusy={grantBusy}
          grantsLoading={grantsLoading}
          grants={grants}
          onClose={() => setGrantFor(null)}
          onSubmit={submitGrant}
        />
      )}
    </div>
  )
}