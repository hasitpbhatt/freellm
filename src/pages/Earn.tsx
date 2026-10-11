import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Button, Card, CardHeader, Credits } from '../components/ui'

type EarnState = {
  verified: boolean
  checkin: {
    checked_in_today: boolean
    streak: number
    streak_if_checked_in: number
    today_reward: number
    calendar: string[]
    milestones: { day: number; bonus: number }[]
    next_milestone: { day: number; bonus: number; days_away: number } | null
  }
  referral: {
    code: string
    link: string
    qualified: number
    pending: number
    total_earned: number
    reward: number
    rows: {
      username: string
      status: string
      reward: number | null
      tenure_days: number
      tokens_used: number
      progress_pct: number
      milestone: { tenure_days: number; tokens: number }
    }[]
  }
  tasks: {
    id: string
    slug: string
    title: string
    description: string | null
    reward: number
    url: string | null
    completed: boolean
  }[]
}

export default function Earn() {
  const { user, loading, refresh } = useAuth()
  const [state, setState] = useState<EarnState | null>(null)
  const [code, setCode] = useState('')
  const [redeemStatus, setRedeemStatus] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [verifyLink, setVerifyLink] = useState<string | null>(null)
  const [openedTask, setOpenedTask] = useState<string | null>(null)
  const [redemptions, setRedemptions] = useState<{ credits: number; created_at: number; code: string; model_label: string | null }[]>([])

  const load = useCallback(async () => {
    try {
      const [earn, mine] = await Promise.all([
        api.get<EarnState>('/earn'),
        api.get<{ redemptions: { credits: number; created_at: number; code: string; model_label: string | null }[] }>('/promos/mine'),
      ])
      setState(earn)
      setRedemptions(mine.redemptions)
    } catch {
      // unauthenticated visitors fall through to the CTA below
    }
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true)
    setBanner(null)
    try {
      await fn()
      await Promise.all([load(), refresh()])
      setBanner({ kind: 'ok', text: success })
    } catch (err) {
      setBanner({ kind: 'err', text: err instanceof ApiError ? err.message : 'Something failed.' })
    } finally {
      setBusy(false)
    }
  }

  async function redeem(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setRedeemStatus(null)
    try {
      const data = await api.post<{ redeemed: { code: string; credits: number; model: { label: string } | null } }>(
        '/promos/redeem',
        { code },
      )
      setRedeemStatus({
        kind: 'ok',
        message: `+${data.redeemed.credits.toLocaleString('en-US')} cr${
          data.redeemed.model ? ` for ${data.redeemed.model.label}` : ''
        } — ${data.redeemed.code} redeemed.`,
      })
      setCode('')
      await Promise.all([load(), refresh()])
    } catch (err) {
      setRedeemStatus({ kind: 'err', message: err instanceof ApiError ? err.message : 'Redemption failed.' })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  if (!user) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Earn credits</h1>
        <p className="mt-2 text-[13px] text-muted">
          Credits spend 1:1 on tokens in The Pool. Sign in to check in daily, invite friends, and
          redeem promo codes.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link to="/register"><Button>Create account</Button></Link>
          <Link to="/login"><Button variant="secondary">Sign in</Button></Link>
        </div>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Earn credits</h1>
        <p className="mt-1 text-[13px] text-muted">
          Credits spend 1:1 on tokens in The Pool. Your own key is always free.
        </p>
      </div>

      {banner && <p className={`text-[13px] ${banner.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>{banner.text}</p>}

      {/* Verification gate */}
      {state && !state.verified && (
        <Card className="border-warn/40 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-warn">
              Verify your email to unlock earning — check-ins, tasks, and referral payouts are gated.
            </span>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const data = await api.post<{ dev_link?: string }>('/auth/resend-verification')
                  if (data.dev_link) setVerifyLink(data.dev_link)
                }, 'Verification link sent — check your inbox.')
              }
            >
              Resend link
            </Button>
          </div>
          {verifyLink && (
            <p className="mt-2 text-[12px] text-muted">
              dev link: <a href={verifyLink} className="text-accent hover:underline">{verifyLink}</a>
            </p>
          )}
        </Card>
      )}

      {/* Balance */}
      <Card>
        <CardHeader title="Balance" />
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-accent">◇</span>
            <span className="num text-2xl font-semibold">
              <Credits value={user.balance_credits} />
            </span>
            <span className="text-[13px] text-muted">cr · any model</span>
            <Link to="/usage" className="ml-auto text-[13px] text-accent hover:underline">Usage →</Link>
          </div>
        </div>
      </Card>

      {/* Daily check-in */}
      {state && (
        <Card>
          <CardHeader
            title="Daily check-in"
            action={<span className="num text-[12px] text-muted">base 50,000 cr</span>}
          />
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[13px]">
                {state.checkin.checked_in_today ? (
                  <>
                    🔥 <span className="num">{state.checkin.streak}</span>-day streak
                  </>
                ) : (
                  <>
                    Check in to start a <span className="num">{state.checkin.streak_if_checked_in}</span>-day streak
                  </>
                )}
              </span>
              {state.checkin.checked_in_today ? (
                <span className="text-[13px] text-muted">✓ Checked in today — come back tomorrow</span>
              ) : (
                <Button
                  disabled={busy || !state.verified}
                  onClick={() => void run(() => api.post('/checkin'), `Checked in — +${state.checkin.today_reward.toLocaleString('en-US')} cr`)}
                >
                  Check in · +{state.checkin.today_reward.toLocaleString('en-US')}
                </Button>
              )}
            </div>

            {/* 7-day calendar */}
            <div className="flex gap-1.5">
              {last7Days().map((day) => {
                const done = state.checkin.calendar.includes(day)
                const isToday = day === todayUtc()
                return (
                  <div
                    key={day}
                    className={`flex h-9 flex-1 items-center justify-center rounded-md border text-[11px] ${
                      done
                        ? 'border-gain/40 bg-gain/10 text-gain'
                        : isToday
                          ? 'border-accent text-accent'
                          : 'border-line text-muted'
                    }`}
                    title={day}
                  >
                    {day.slice(8)}
                  </div>
                )
              })}
            </div>

            <p className="num text-[12px] text-muted">
              {state.checkin.milestones.map((m) => `day ${m.day} → +${(m.bonus / 1000).toLocaleString('en-US')}K`).join(' · ')}
              {state.checkin.next_milestone && (
                <> · next bonus in {state.checkin.next_milestone.days_away} day{state.checkin.next_milestone.days_away === 1 ? '' : 's'}</>
              )}
            </p>
          </div>
        </Card>
      )}

      {/* Referrals */}
      {state && (
        <Card>
          <CardHeader
            title="Invite friends"
            action={<span className="num text-[12px] text-muted">+{(state.referral.reward / 1000).toLocaleString('en-US')}K each</span>}
          />
          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <code className="num flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px]">
                {state.referral.link}
              </code>
              <Button
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.referral.link)
                  setBanner({ kind: 'ok', text: 'Link copied — share it anywhere.' })
                }}
              >
                Copy link
              </Button>
              {'share' in navigator && (
                <Button
                  variant="ghost"
                  onClick={() => void navigator.share({ url: state.referral.link, title: 'freellm' })}
                >
                  Share
                </Button>
              )}
            </div>
            <p className="text-[12px] text-muted">
              Paid when a friend stays active for {state.referral.rows[0]?.milestone.tenure_days ?? 7} days or uses{' '}
              {((state.referral.rows[0]?.milestone.tokens ?? 200_000) / 1000).toLocaleString('en-US')}K tokens.
            </p>

            {state.referral.rows.length > 0 && (
              <div className="flex flex-col divide-y divide-line">
                {state.referral.rows.map((row, index) => (
                  <div key={`${row.username}-${index}`} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="text-[13px]">{row.username}</span>
                    {row.status === 'paid' ? (
                      <span className="num text-[12px] text-gain">✓ +{row.reward?.toLocaleString('en-US')} paid</span>
                    ) : (
                      <>
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                          <div className="h-full bg-accent" style={{ width: `${row.progress_pct}%` }} />
                        </div>
                        <span className="num text-[12px] text-muted">
                          {row.tenure_days}d · {(row.tokens_used / 1000).toFixed(0)}K tokens · {row.progress_pct}%
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {state.referral.rows.length === 0 && (
              <p className="text-[13px] text-muted">No referrals yet. Your link works anywhere.</p>
            )}
          </div>
        </Card>
      )}

      {/* Tasks */}
      {state && (
        <Card>
          <CardHeader title="Tasks" />
          <div className="flex flex-col divide-y divide-line">
            {state.tasks.map((task) => (
              <div key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {task.completed ? (
                  <>
                    <span className="text-gain">✅</span>
                    <span className="text-[13px]">{task.title}</span>
                    <span className="num ml-auto text-[12px] text-gain">+{task.reward.toLocaleString('en-US')}</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted">○</span>
                    <span className="text-[13px]">{task.title}</span>
                    <span className="num text-[12px] text-muted">+{task.reward.toLocaleString('en-US')}</span>
                    <span className="ml-auto flex gap-2">
                      {openedTask === task.id ? (
                        <Button
                          disabled={busy || !state.verified}
                          onClick={() => void run(() => api.post(`/tasks/${task.slug}/complete`), `Claimed +${task.reward.toLocaleString('en-US')} cr`)}
                        >
                          Confirm
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setOpenedTask(task.id)
                            if (task.url) window.open(task.url, '_blank', 'noopener')
                          }}
                        >
                          Do it
                        </Button>
                      )}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Promo redemption */}
      <Card>
        <CardHeader title="Redeem a promo code" />
        <form className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end" onSubmit={redeem}>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-[12px] font-medium uppercase tracking-wide text-muted">Code</span>
            <input
              className="input num"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="LAUNCH-2026"
              required
            />
          </label>
          <Button type="submit" disabled={busy || code.trim() === ''}>
            {busy ? 'Redeeming…' : 'Redeem'}
          </Button>
        </form>
        {redeemStatus && (
          <p className={`px-4 pb-4 text-[13px] ${redeemStatus.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
            {redeemStatus.message}
          </p>
        )}
      </Card>

      {/* My redemptions */}
      {redemptions.length > 0 && (
        <Card>
          <CardHeader title="Your redemptions" />
          <div className="flex flex-col divide-y divide-line">
            {redemptions.map((r, index) => (
              <div key={`${r.code}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
                <code className="num text-[12px] text-muted">{r.code}</code>
                <span className="num ml-auto text-[13px] text-gain">+{r.credits.toLocaleString('en-US')}</span>
                {r.model_label && <span className="text-[12px] text-muted">{r.model_label}</span>}
                <span className="num text-[12px] text-muted">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function last7Days(): string[] {
  const days: string[] = []
  for (let i = 6; i >= 0; i -= 1) {
    days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10))
  }
  return days
}
