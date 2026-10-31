import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { Button, Card, CardHeader, Credits } from '../components/ui'
import ArcadePanel from '../components/ArcadePanel'

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
  const [busyAction, setBusyAction] = useState<string | null>(null)
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
    if (user) {
      // oxlint-disable-next-line react/set-state-in-effect -- earn state load when the session resolves or refreshes
      void load()
    }
  }, [user, load])

  async function run(action: string, fn: () => Promise<unknown>, success: string) {
    setBusyAction(action)
    setBanner(null)
    try {
      await fn()
      await Promise.all([load(), refresh()])
      setBanner({ kind: 'ok', text: success })
    } catch (err) {
      setBanner({ kind: 'err', text: err instanceof ApiError ? err.message : 'Something failed.' })
    } finally {
      setBusyAction(null)
    }
  }

  async function redeem(event: FormEvent) {
    event.preventDefault()
    setBusyAction('redeem')
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
      setBusyAction(null)
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
          <Link to="/login"><Button>Sign in with Google</Button></Link>
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

      {banner && (
        <p role={banner.kind === 'err' ? 'alert' : 'status'} className={`flex flex-wrap items-center gap-2 text-[13px] ${banner.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
          <span className="flex-1">{banner.kind === 'ok' ? '✓ ' : '⚠ '}{banner.text}</span>
          <button onClick={() => setBanner(null)} className="min-h-[44px] px-2 text-muted hover:text-content" aria-label="Dismiss message">
            Dismiss
          </button>
        </p>
      )}

      {/* Verification gate */}
      {state && !state.verified && (
        <Card className="border-warn/40 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-warn">
              Verify {user.email} to unlock earning — check-ins, tasks, and referral payouts are gated.
            </span>
            <Button
              variant="secondary"
              disabled={busyAction !== null}
              onClick={() =>
                void run('resend', async () => {
                  const data = await api.post<{ dev_link?: string }>('/auth/resend-verification')
                  if (data.dev_link) setVerifyLink(data.dev_link)
                }, `Verification link sent to ${user.email} — check your inbox.`)
              }
            >
              {busyAction === 'resend' ? 'Sending…' : 'Resend link'}
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
                    <span aria-hidden="true">🔥</span> <span className="num">{state.checkin.streak}</span>-day streak
                    <span className="sr-only"> days in a row</span>
                  </>
                ) : (
                  <>
                    Check in to start a <span className="num">{state.checkin.streak_if_checked_in}</span>-day streak
                  </>
                )}
              </span>
              {state.checkin.checked_in_today ? (
                <span className="text-[13px] text-muted"><span aria-hidden="true">✓</span> Checked in today — come back tomorrow</span>
              ) : (
                <Button
                  className="w-full sm:w-auto"
                  disabled={busyAction !== null || !state.verified}
                  onClick={() => void run('checkin', () => api.post('/checkin'), `Checked in — +${state.checkin.today_reward.toLocaleString('en-US')} cr`)}
                >
                  {busyAction === 'checkin' ? 'Checking in…' : `Check in · +${state.checkin.today_reward.toLocaleString('en-US')}`}
                </Button>
              )}
            </div>

            {/* 7-day calendar */}
            <div className="flex gap-1.5" role="list" aria-label="Check-ins, last 7 days (UTC dates)">
              {last7Days().map((day) => {
                const done = state.checkin.calendar.includes(day)
                const isToday = day === todayUtc()
                const label = `${day}: ${done ? 'checked in' : isToday ? 'today, not yet checked in' : 'missed'}`
                return (
                  <div
                    key={day}
                    role="listitem"
                    aria-label={label}
                    className={`flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-1 text-[11px] ${
                      done
                        ? 'border-gain/40 bg-gain/10 font-semibold text-gain'
                        : isToday
                          ? 'border-accent font-semibold text-accent'
                          : 'border-line text-muted'
                    }`}
                    title={label}
                  >
                    <span aria-hidden="true">{day.slice(8)}</span>
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

      {/* Daily arcade — skill games with bounded payouts */}
      {user && <ArcadePanel />}

      {/* Referrals */}
      {state && (
        <Card>
          <CardHeader
            title="Invite friends"
            action={<span className="num text-[12px] text-muted">+{state.referral.reward.toLocaleString('en-US')} cr each</span>}
          />
          <div className="flex flex-col gap-4 p-4">
            <p className="text-[12px] text-muted">
              Share this link anywhere — post it, message it, put it in your bio:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="invite-link">Your invite link</label>
              <code id="invite-link" className="num min-w-0 flex-1 break-all rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px]">
                {state.referral.link}
              </code>
              <Button
                variant="secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(state.referral.link)
                    setBanner({ kind: 'ok', text: 'Link copied — share it anywhere.' })
                  } catch {
                    setBanner({ kind: 'err', text: 'Copy blocked by the browser — select the link above manually.' })
                  }
                }}
              >
                Copy link
              </Button>
              {'share' in navigator && (
                <Button
                  variant="ghost"
                  title="Share via your device's share sheet (mobile)"
                  onClick={() => void navigator.share({ url: state.referral.link, title: 'freellm' })}
                >
                  Share
                </Button>
              )}
            </div>
            <p className="text-[12px] text-muted">
              Paid when a friend stays active for {state.referral.rows[0]?.milestone.tenure_days ?? 7} days <strong>or</strong> uses{' '}
              {((state.referral.rows[0]?.milestone.tokens ?? 200_000) / 1000).toLocaleString('en-US')}K pool tokens — whichever comes first.
            </p>

            {state.referral.rows.length > 0 && (
              <div className="flex flex-col divide-y divide-line">
                {state.referral.rows.map((row, index) => (
                  <div key={`${row.username}-${index}`} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="text-[13px]">{row.username}</span>
                    {row.status === 'paid' ? (
                      <span className="num text-[12px] text-gain"><span aria-hidden="true">✓</span> +{row.reward?.toLocaleString('en-US')} paid</span>
                    ) : (
                      <>
                        <div
                          className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2"
                          role="progressbar"
                          aria-valuenow={row.progress_pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Progress for ${row.username}: ${row.progress_pct} percent`}
                        >
                          <div className="h-full bg-accent" style={{ width: `${row.progress_pct}%` }} />
                        </div>
                        <span className="num text-[12px] text-muted">
                          {row.tenure_days}d active · {(row.tokens_used / 1000).toFixed(0)}K tokens · {row.progress_pct}% to payout
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {state.referral.rows.length === 0 && (
              <p className="text-[13px] text-muted">No referrals yet. Share your link above — your friend signs in with Google and you both get paid once they're active a week or use 200K tokens.</p>
            )}
          </div>
        </Card>
      )}

      {/* Tasks */}
      {state && (
        <Card>
          <CardHeader title="Tasks" />
          <div className="flex flex-col divide-y divide-line">
            {[...state.tasks].sort((a, b) => Number(a.completed) - Number(b.completed)).map((task) => (
              <div key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {task.completed ? (
                  <>
                    <span className="text-gain" aria-hidden="true">✅</span>
                    <span className="sr-only">Done: </span>
                    <span className="text-[13px]">{task.title}</span>
                    <span className="num ml-auto text-[12px] text-gain">+{task.reward.toLocaleString('en-US')}</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted" aria-hidden="true">○</span>
                    <span className="sr-only">Not started: </span>
                    <div className="flex min-w-[200px] flex-1 flex-col">
                      <span className="text-[13px]">{task.title}</span>
                      {task.description && (
                        <span className="text-[12px] text-muted">{task.description}</span>
                      )}
                      {task.url && openedTask !== task.id && (
                        <span className="text-[12px] text-muted">Opens {task.url} in a new tab — finish it there, then press Confirm.</span>
                      )}
                    </div>
                    <span className="num text-[12px] text-muted">+{task.reward.toLocaleString('en-US')}</span>
                    <span className="ml-auto flex gap-2">
                      {openedTask === task.id ? (
                        <Button
                          disabled={busyAction !== null || !state.verified}
                          onClick={() => void run(`task:${task.id}`, () => api.post(`/tasks/${task.slug}/complete`), `Claimed +${task.reward.toLocaleString('en-US')} cr`)}
                        >
                          {busyAction === `task:${task.id}` ? 'Claiming…' : 'Confirm'}
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
            <span className="text-[12px] font-medium uppercase tracking-wide text-muted">Code — from an admin or friend, letters and dashes</span>
            <input
              className="input num"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. WELCOME-500K"
              required
            />
          </label>
          <Button type="submit" disabled={busyAction !== null || code.trim() === ''}>
            {busyAction === 'redeem' ? 'Redeeming…' : 'Redeem'}
          </Button>
        </form>
        {redeemStatus && (
          <p role={redeemStatus.kind === 'err' ? 'alert' : 'status'} className={`px-4 pb-4 text-[13px] ${redeemStatus.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
            {redeemStatus.message}
          </p>
        )}
      </Card>

      {/* My redemptions */}
      <Card>
        <CardHeader title="Your redemptions" />
        {redemptions.length === 0 ? (
          <p className="p-4 text-[13px] text-muted">None yet — redeemed promo codes will show here with their date.</p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {redemptions.map((r, index) => (
              <div key={`${r.code}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <code className="num min-w-0 break-all text-[12px] text-muted">{r.code}</code>
                <span className="num ml-auto shrink-0 text-[13px] text-gain">+{r.credits.toLocaleString('en-US')}</span>
                {r.model_label && <span className="min-w-0 truncate text-[12px] text-muted">{r.model_label} only</span>}
                <span className="num shrink-0 text-[12px] text-muted" title={new Date(r.created_at).toLocaleString()}>
                  {new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
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
