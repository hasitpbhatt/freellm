import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { Button, Card, CardHeader } from '../components/ui'
import { formatDelta } from '../lib/format'

type LedgerEntry = { delta: number; reason: string; meta: Record<string, unknown> | null; created_at: number }

type EarnState = {
  verified: boolean
  checkin: { checked_in_today: boolean; streak: number; today_reward: number }
  referral: { code: string; pending: number; qualified: number }
}

const REASON_LABELS: Record<string, string> = {
  daily_checkin: 'Daily check-in',
  referral_reward: 'Referral reward',
  task_reward: 'Task reward',
  key_contribution: 'Key contribution',
  key_upkeep: 'Key upkeep',
  admin_grant: 'Admin grant',
  chat_spend: 'Pool chat',
  promo_code: 'Promo code',
  game_reward: 'Arcade game',
  refund: 'Refund',
}

export default function Dashboard() {
  const { user, loading, refresh } = useAuth()
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null)
  const [earn, setEarn] = useState<EarnState | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [checkingIn, setCheckingIn] = useState(false)

  const loadData = useCallback(async () => {
    if (!user) return
    try {
      const [ledgerData, earnData] = await Promise.all([
        api.get<{ entries: LedgerEntry[] }>('/ledger'),
        api.get<EarnState>('/earn'),
      ])
      setLedger(ledgerData.entries)
      setEarn(earnData)
      setLoadError(false)
    } catch {
      // if the session died mid-load the shell redirects to sign-in
      setLoadError(true)
    }
  }, [user])

  // Load data on user change - only run once when user changes
  useEffect(() => {
    if (user && !loading) {
      // oxlint-disable-next-line react/set-state-in-effect -- dashboard data load when the session resolves
      void loadData()
    }
  }, [user, loading, loadData])

  if (loading) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>
  if (!user) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="mt-2 text-[13px] text-muted">Sign in to see your balance and activity.</p>
        <div className="mt-4 flex justify-center gap-3">
          <Link to="/login"><Button>Sign in with Google</Button></Link>
        </div>
      </Card>
    )
  }
  if (loadError && ledger === null) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="mt-2 text-[13px] text-muted">Could not load your activity. Check your connection and try again.</p>
        <div className="mt-4 flex justify-center gap-3">
          <Button onClick={() => void loadData()}>Retry</Button>
        </div>
      </Card>
    )
  }

  const hasCheckedIn = earn?.checkin.checked_in_today ?? false
  const hasBalance = user.balance_credits > 0
  const checklist = [
    { done: earn?.verified ?? false, label: 'Verify your email', detail: 'Unlocks earning', to: '/earn' },
    { done: hasCheckedIn, label: 'Check in today', detail: '+50,000 cr', to: '/earn' },
    { done: hasBalance, label: 'Earn your first credits', detail: 'Check-in, tasks, referrals', to: '/earn' },
    { done: (earn?.referral.qualified ?? 0) > 0, label: 'Invite a friend', detail: '+500,000 cr when they qualify', to: '/earn' },
  ]
  const completed = checklist.filter((item) => {
    if (typeof item.done === 'boolean') return item.done
    if (typeof item.done === 'number') return Boolean(item.done)
    return false
  }).length

   async function checkIn() {
     setCheckingIn(true)
     try {
       await api.post('/checkin')
       await Promise.all([loadData(), refresh()])
     } finally {
       setCheckingIn(false)
     }
   }

  return (
    <div className="flex flex-col gap-6">
      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Link to="/chat"><Button size="sm">Start chat</Button></Link>
        <Link to="/keys"><Button size="sm" variant="secondary">Add a key</Button></Link>
        <Link to="/earn"><Button size="sm" variant="secondary">Earn more credits</Button></Link>
        <Link to="/models"><Button size="sm" variant="ghost">Browse models</Button></Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Balance */}
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-muted">Balance</p>
          <p className="num mt-1 text-2xl font-semibold">{user.balance_credits.toLocaleString('en-US')}</p>
          <p className="text-[12px] text-muted">credits · 1 credit = 1 token on any model</p>
          <Link to="/usage" className="mt-2 inline-block text-[13px] text-accent hover:underline">Usage →</Link>
        </Card>

        {/* Streak */}
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-muted">Streak</p>
          <p className="num mt-1 text-2xl font-semibold">
            <span aria-hidden="true">🔥</span> {earn ? earn.checkin.streak : '—'}
            <span className="sr-only"> day streak{earn && earn.checkin.streak !== 1 ? 's' : ''}</span>
          </p>
          <p className="text-[12px] text-muted">days checked in</p>
          {hasCheckedIn ? (
            <p className="mt-2 text-[13px] text-muted">Checked in today <span aria-hidden="true">✓</span></p>
          ) : (
            <>
              <Button className="mt-2" variant="secondary" disabled={checkingIn || !earn?.verified} onClick={() => void checkIn()}>
                {checkingIn ? 'Checking in…' : 'Check in'}
              </Button>
              {earn && !earn.verified && (
                <p className="mt-1 text-[12px] text-muted">
                  Verify your email on the <Link to="/earn" className="text-accent hover:underline">Earn page</Link> first.
                </p>
              )}
            </>
          )}
        </Card>

        {/* Referrals */}
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-muted">Referrals</p>
          <p className="num mt-1 text-2xl font-semibold">
            {earn?.referral.qualified ?? 0}
            <span className="text-[13px] text-muted"> paid</span>
          </p>
          <p className="num text-[12px] text-muted">{earn?.referral.pending ?? 0} pending</p>
          <Link to="/earn" className="mt-2 inline-block text-[13px] text-accent hover:underline">Invite →</Link>
        </Card>
      </div>

      {/* First-run checklist — teaches the model through action */}
      <Card>
        <CardHeader title="Getting started" action={<span className="num text-[12px] text-muted">{completed}/4</span>} />
        <div className="flex flex-col divide-y divide-line">
          {checklist.map((item) => (
            <div key={item.label} className="flex items-center gap-3 px-4 py-3">
              <span className={item.done ? 'text-gain' : 'text-muted'} aria-hidden="true">{item.done ? '✅' : '○'}</span>
              <span className="sr-only">{item.done ? 'Done' : 'Not started'}: </span>
              <div className="flex flex-col">
                <span className="text-[13px] font-medium">{item.label}</span>
                <span className="text-[12px] text-muted">{item.detail}</span>
              </div>
              {!item.done && (
                <Link to={item.to} className="ml-auto btn-secondary btn-sm min-w-[64px]" aria-label={`${item.label} — open Earn page`}>
                  Go
                </Link>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Recent activity */}
      <Card>
        <CardHeader title="Recent activity" action={<Link to="/usage" className="text-[13px] text-accent hover:underline">All usage →</Link>} />
        {ledger === null && <p className="p-4 text-[13px] text-muted">Loading…</p>}
        {ledger?.length === 0 && <p className="p-4 text-[13px] text-muted">Nothing yet — check in to get started.</p>}
        <div className="flex flex-col divide-y divide-line">
          {ledger?.slice(0, 8).map((entry, index) => (
            <div key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className={`num w-24 shrink-0 text-right text-[13px] ${entry.delta > 0 ? 'text-gain' : entry.delta < 0 ? 'text-loss' : 'text-content'}`} aria-label={entry.delta > 0 ? `+${entry.delta} earned` : `${entry.delta} spent`}>
                {formatDelta(entry.delta)}
              </span>
              <span className="min-w-0 truncate text-[13px]">{REASON_LABELS[entry.reason] ?? 'Other activity'}</span>
              {typeof entry.meta?.model === 'string' && (
                <span className="min-w-0 max-w-full truncate text-[12px] text-muted">{entry.meta.model}</span>
              )}
              <span className="num ml-auto shrink-0 text-[12px] text-muted" title={new Date(entry.created_at).toLocaleString()}>{relativeTime(entry.created_at)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
