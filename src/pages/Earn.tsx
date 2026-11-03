import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { Button, Card } from '../components/ui'
import ArcadePanel, { type ArcadeSessionStats } from '../components/ArcadePanel'
import TodayCard from '../components/TodayCard'
import EarnTile from '../components/EarnTile'
import EarnOnboarding from '../components/EarnOnboarding'
import InviteComposer from '../components/InviteComposer'
import WeeklyQuests from '../components/WeeklyQuests'
import Leaderboards from '../components/Leaderboards'
import Badges from '../components/Badges'
import FriendsStreaks from '../components/FriendsStreaks'
import SeasonalEvents from '../components/SeasonalEvents'
import { useHaptics } from '../lib/useHaptics'

/** Rough estimate: typical pool message costs 1,500-4,000 credits depending on model. */
function creditsToMessages(credits: number): string {
  const min = Math.round(credits / 4000)
  const max = Math.round(credits / 1500)
  if (min === max) return `≈${min.toLocaleString()} pool messages`
  return `≈${min.toLocaleString()}–${max.toLocaleString()} pool messages`
}

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
  streak_freezes: number
  freeze_used_today: boolean
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

type GamesStatus = {
  earned_today: number
  games: Record<string, { plays_left: number; plays_cap: number }>
  level: {
    level: number
    xp: number
    max_level: number
    next_xp: number | null
    pending: { level: number; reward: number } | null
  }
  clear: {
    done: boolean
    ready: boolean
    reward: number
    needs: string[]
  }
  typing_tiers: { min_wpm: number; reward: number }[]
  memory_tiers: { max_moves: number; reward: number }[]
}

export default function Earn() {
  const { user, loading, refresh } = useAuth()
  const { pulse } = useHaptics()
  const [state, setState] = useState<EarnState | null>(null)
  const [gamesStatus, setGamesStatus] = useState<GamesStatus | null>(null)
  const [code, setCode] = useState('')
  const [redeemStatus, setRedeemStatus] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [verifyLink, setVerifyLink] = useState<string | null>(null)
  const [openedTask, setOpenedTask] = useState<string | null>(null)
  const [redemptions, setRedemptions] = useState<{ credits: number; created_at: number; code: string; model_label: string | null }[]>([])
  const [arcadeStats, setArcadeStats] = useState<ArcadeSessionStats>({
    typingPlaysUsed: 0,
    memoryPlaysUsed: 0,
    bestWpm: null,
    bestMemoryMoves: null,
  })
  const [nextResetMs, setNextResetMs] = useState(0)
  const [expandedTile, setExpandedTile] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [earn, mine, games] = await Promise.all([
        api.get<EarnState>('/earn'),
        api.get<{ redemptions: { credits: number; created_at: number; code: string; model_label: string | null }[] }>('/promos/mine'),
        api.get<GamesStatus>('/games/status'),
      ])
      setState(earn)
      setGamesStatus(games)
      setRedemptions(mine.redemptions)

      // Calculate next UTC midnight
      const now = Date.now()
      const nextReset = now + 86_400_000 - (now % 86_400_000)
      setNextResetMs(nextReset)
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

  const handleCheckIn = () => {
    const isFirstCheckIn = state && state.checkin.streak === 0
    run('checkin', () => api.post('/checkin'), isFirstCheckIn
      ? `🔥 Streak started! Day 7 = 500k, Day 30 = 2M — +${state?.checkin.today_reward.toLocaleString('en-US')} cr`
      : `Checked in — +${state?.checkin.today_reward.toLocaleString('en-US')} cr`)
    pulse('checkin')
  }

  const handleOpenArcade = () => {
    const section = document.getElementById('arcade-section')
    section?.scrollIntoView({ behavior: 'smooth' })
  }

  const makeTileExpandHandler = (tileId: string) => (expanded: boolean) => {
    setExpandedTile(expanded ? tileId : null)
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

  // Progress aggregate for TodayCard
  const progress = state && gamesStatus ? {
    checkin: state.checkin.checked_in_today,
    typing: (gamesStatus.games.typing?.plays_cap ?? 3) - (gamesStatus.games.typing?.plays_left ?? 3),
    memory: (gamesStatus.games.memory?.plays_cap ?? 2) - (gamesStatus.games.memory?.plays_left ?? 2),
    clear: gamesStatus.clear.done,
  } : { checkin: false, typing: 0, memory: 0, clear: false }

  // Arcade tile content
  const arcadeTileContent = state && gamesStatus ? (
    <div className="flex flex-col gap-3 text-[12px]">
      <div className="flex items-center justify-between">
        <span className="text-muted">Typing</span>
        <span className="num text-content">
          {arcadeStats.typingPlaysUsed} / {gamesStatus.games.typing?.plays_cap ?? 3} plays
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-accent" style={{ width: `${(arcadeStats.typingPlaysUsed / (gamesStatus.games.typing?.plays_cap ?? 3)) * 100}%` }} />
      </div>
      <p className="text-[11px] text-muted">80 WPM: 10k | 50 WPM: 5k | Any: 2.5k (3×/day)</p>
      <div className="flex items-center justify-between">
        <span className="text-muted">Memory</span>
        <span className="num text-content">
          {arcadeStats.memoryPlaysUsed} / {gamesStatus.games.memory?.plays_cap ?? 2} plays
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-accent" style={{ width: `${(arcadeStats.memoryPlaysUsed / (gamesStatus.games.memory?.plays_cap ?? 2)) * 100}%` }} />
      </div>
      <p className="text-[11px] text-muted">≤8 moves: 12k | ≤12 moves: 8k | Any: 4k (2×/day)</p>
      <p className="text-[11px] text-muted">
        Clear bonus: +{gamesStatus.clear.reward.toLocaleString()} cr · {gamesStatus.clear.done ? 'Claimed' : gamesStatus.clear.ready ? 'Ready to claim' : `${gamesStatus.clear.needs.length} game${gamesStatus.clear.needs.length !== 1 ? 's' : ''} left`}
      </p>
      {gamesStatus.level.pending && (
        <p className="text-[11px] text-gain">Level {gamesStatus.level.pending.level} bonus: +{gamesStatus.level.pending.reward.toLocaleString()} cr — claim in Arcade</p>
      )}
      {gamesStatus.level.next_xp !== null && (
        <div className="space-y-1.5 pt-2 border-t border-line">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted">Level {gamesStatus.level.level} progress</span>
            <span className="num text-content">{gamesStatus.level.xp.toLocaleString()} / {gamesStatus.level.next_xp.toLocaleString()} XP</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent" style={{ width: `${(gamesStatus.level.xp / gamesStatus.level.next_xp) * 100}%` }} />
          </div>
          <p className="text-[10px] text-gain">
            Next level ({gamesStatus.level.level + 1}): +{(gamesStatus.level.level + 1) * 3000} cr bonus
          </p>
        </div>
      )}
    </div>
  ) : null

  // Referral tile content
  const referralTileContent = state ? (
    <div className="flex flex-col gap-3 text-[12px]">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="invite-link-tile">Your invite link</label>
        <code id="invite-link-tile" className="num min-w-0 flex-1 break-all rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[11px]">
          {state.referral.link}
        </code>
        <Button size="sm" variant="secondary" onClick={async (e) => {
          e.stopPropagation()
          try {
            await navigator.clipboard.writeText(state.referral.link)
            setBanner({ kind: 'ok', text: 'Link copied — share it anywhere.' })
            pulse('referral')
          } catch {
            setBanner({ kind: 'err', text: 'Copy blocked — select the link manually.' })
          }
        }}>
          Copy
        </Button>
        {'share' in navigator && (
          <Button size="sm" variant="ghost" title="Share via your device's share sheet" onClick={(e) => {
            e.stopPropagation()
            void navigator.share({ url: state.referral.link, title: 'freellm' })
          }}>
            Share
          </Button>
        )}
      </div>
      <p className="text-muted">
        {state.referral.qualified} paid · {state.referral.pending} pending · +{state.referral.reward.toLocaleString()} cr each
      </p>
      <InviteComposer link={state.referral.link} />
      {state.referral.rows.length === 0 ? (
        <div className="space-y-2 text-[11px] text-muted">
          <p>Friends qualify at <strong>7-day streak</strong> or <strong>200k Pool tokens</strong> used.</p>
          <p className="text-accent">Share your link above → they get 50k on signup, you both earn 500k when they qualify.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-40 overflow-auto">
          {state.referral.rows.slice(0, 3).map((row, index) => (
            <div key={`${row.username}-${index}`} className="flex flex-wrap items-center gap-2 py-1.5 text-[11px]">
              <span className="font-medium">{row.username}</span>
              {row.status === 'paid' ? (
                <span className="num text-gain"><span aria-hidden="true">✓</span> Paid</span>
              ) : (
                <>
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={row.progress_pct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-accent" style={{ width: `${row.progress_pct}%` }} />
                  </div>
                  <span className="num text-muted">{row.progress_pct}%</span>
                </>
              )}
            </div>
          ))}
          {state.referral.rows.length > 3 && (
            <span className="text-muted">+{state.referral.rows.length - 3} more…</span>
          )}
        </div>
      )}
    </div>
  ) : null

  // Tasks tile content
  const tasksTileContent = state ? (
    <div className="flex flex-col gap-2 text-[12px] max-h-60 overflow-auto">
      {state.tasks.length === 0 ? (
        <div className="space-y-1 text-muted">
          <p>All caught up! New tasks appear when we launch features.</p>
          <p className="text-[11px]"><a href="https://x.com/freellm" target="_blank" rel="noopener" className="text-accent hover:underline">Follow @freellm</a> for updates.</p>
        </div>
      ) : (
        [...state.tasks].sort((a, b) => Number(a.completed) - Number(b.completed)).map((task) => (
          <div key={task.id} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-surface-2">
            <span className={task.completed ? 'text-gain' : 'text-muted'} aria-hidden="true">
              {task.completed ? '✅' : '○'}
            </span>
            <span className={`text-[13px] ${task.completed ? 'line-through text-muted' : 'text-content'}`}>
              {task.title}
            </span>
            <span className="num ml-auto shrink-0 text-[12px]">{task.completed ? 'Done' : `+${task.reward.toLocaleString()}`}</span>
            {!task.completed && (
              <Button size="sm" variant={openedTask === task.id ? 'primary' : 'secondary'} onClick={(e) => {
                e.stopPropagation()
                setOpenedTask(openedTask === task.id ? null : task.id)
                if (task.url && openedTask !== task.id) window.open(task.url, '_blank', 'noopener')
              }}>
                {openedTask === task.id ? 'Confirm' : 'Do it'}
              </Button>
            )}
          </div>
        ))
      )}
      {openedTask && (
        <Button size="sm" variant="ghost" className="w-full" onClick={(e) => {
          e.stopPropagation()
          setOpenedTask(null)
        }}>
          Close task details
        </Button>
      )}
    </div>
  ) : null

  // Arcade tile status
  const arcadeStatus: 'ready' | 'partial' | 'done' | 'locked' = !state?.verified ? 'locked'
    : progress.clear ? 'done'
    : (progress.typing > 0 || progress.memory > 0) ? 'partial'
    : 'ready'

  // Referral tile status
  const referralStatus: 'ready' | 'partial' | 'done' | 'locked' = !state?.verified ? 'locked'
    : state.referral.qualified > 0 ? 'partial'
    : 'ready'

  // Tasks tile status
  const tasksStatus: 'ready' | 'partial' | 'done' | 'locked' = !state?.verified ? 'locked'
    : state.tasks.some(t => !t.completed) ? 'ready'
    : state.tasks.length > 0 ? 'done'
    : 'locked'

  const showOnboarding = state && state.verified && state.checkin.streak === 0 && !state.checkin.checked_in_today

  return (
    <>
      {showOnboarding && (
        <EarnOnboarding
          onComplete={() => {}}
          onSkip={() => {}}
        />
      )}

      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">Earn credits</h1>
          <p className="mt-1 text-[13px] text-muted">
            Credits spend 1:1 on tokens in The Pool. Your own key is always free.
          </p>
          <p className="mt-1 text-[12px] text-accent">{creditsToMessages(50000)} per daily check-in</p>
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
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-warn font-medium">Verify {user.email} to unlock earning</p>
              <ul className="mt-2 space-y-1 text-[12px] text-muted">
                <li>✅ Daily check-in: +50,000 cr/day (streak bonuses at day 7/30)</li>
                <li>✅ Arcade games: up to 61,000 cr/day for skill</li>
                <li>✅ Referrals: +500,000 cr per qualified friend</li>
                <li>✅ Tasks: one-time rewards (e.g., GitHub star)</li>
              </ul>
            </div>
            <Button
              variant="secondary"
              disabled={busyAction !== null}
              className="shrink-0 mt-1"
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

      {/* TODAY HERO CARD */}
      {state && gamesStatus && (
        <TodayCard
          id="today-section"
          streak={state.checkin.streak}
          checkedInToday={state.checkin.checked_in_today}
          todayReward={state.checkin.today_reward}
          earnedToday={gamesStatus.earned_today}
          progress={progress}
          nextResetMs={nextResetMs}
          onCheckIn={handleCheckIn}
          onOpenArcade={handleOpenArcade}
          streakFreezes={state.streak_freezes ?? 0}
          freezeUsedToday={state.freeze_used_today}
        />
      )}

      {/* Inline promo redemption — shows when balance is low */}
      {state && gamesStatus && !state.checkin.checked_in_today && user.balance_credits < 50000 && (
        <Card className="border-cyan/40 bg-cyan/5 p-4" id="promo-inline">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <h3 className="font-semibold text-cyan">Redeem a promo code</h3>
              <p className="text-[13px] text-muted">Boost your balance before checking in — codes from admins or friends.</p>
            </div>
            <form className="flex flex-col gap-2 sm:flex-row sm:items-end w-full sm:w-auto" onSubmit={redeem}>
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-[12px] font-medium uppercase tracking-wide text-muted">Code — letters and dashes</span>
                <input
                  className="input num"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. WELCOME-500K"
                  required
                />
              </label>
              <Button type="submit" disabled={busyAction !== null || code.trim() === ''} className="shrink-0">
                {busyAction === 'redeem' ? 'Redeeming…' : 'Redeem'}
              </Button>
            </form>
            {redeemStatus && (
              <p role={redeemStatus.kind === 'err' ? 'alert' : 'status'} className={`text-[13px] ${redeemStatus.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
                {redeemStatus.message}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* TILE GRID */}
      <div className="grid gap-3 earn-tile-grid sm:grid-cols-2 lg:grid-cols-8">
        {/* Arcade Tile */}
        <EarnTile
          id="arcade-section"
          title="Arcade"
          subtitle={arcadeStats.typingPlaysUsed === 0 && arcadeStats.memoryPlaysUsed === 0
            ? 'First game bonus: +2,500 cr just for trying'
            : `lvl ${gamesStatus?.level.level ?? 1} · ${arcadeStats.typingPlaysUsed} typing, ${arcadeStats.memoryPlaysUsed} memory today`}
          status={arcadeStatus}
          reward="+50k–61k/day"
          actionLabel="Play"
          icon="🎮"
          onAction={handleOpenArcade}
          expanded={expandedTile === 'arcade'}
          onExpand={makeTileExpandHandler('arcade')}
        >
          {arcadeTileContent}
        </EarnTile>

        {/* Referral Tile */}
        <EarnTile
          id="referral-section"
          title="Invite Friends"
          subtitle={`${state?.referral.qualified ?? 0} paid · ${state?.referral.pending ?? 0} pending`}
          status={referralStatus}
          reward={`+${state?.referral.reward.toLocaleString() ?? '500,000'} cr each`}
          actionLabel="View"
          icon="👥"
          onAction={() => {}}
          expanded={expandedTile === 'referral'}
          onExpand={makeTileExpandHandler('referral')}
        >
          {referralTileContent}
        </EarnTile>

        {/* Tasks Tile */}
        <EarnTile
          id="tasks-section"
          title="Tasks"
          subtitle={`${state?.tasks.filter(t => !t.completed).length ?? 0} open · ${state?.tasks.filter(t => t.completed).length ?? 0} done`}
          status={tasksStatus}
          reward={state?.tasks.reduce((sum, t) => sum + (t.completed ? 0 : t.reward), 0).toLocaleString() ? `+${state.tasks.reduce((sum, t) => sum + (t.completed ? 0 : t.reward), 0).toLocaleString()} cr available` : 'No tasks'}
          actionLabel="View"
          icon="📋"
          onAction={() => {}}
          expanded={expandedTile === 'tasks'}
          onExpand={makeTileExpandHandler('tasks')}
        >
          {tasksTileContent}
        </EarnTile>

        {/* Weekly Quests Tile */}
        <EarnTile
          id="weekly-quests-section"
          title="Weekly Quests"
          subtitle="New every Monday"
          status="ready"
          reward="Up to 350k cr/week"
          actionLabel="View"
          icon="📋"
          onAction={() => {}}
          expanded={false}
          onExpand={() => {}}
        >
          <WeeklyQuests />
        </EarnTile>

        {/* Leaderboards Tile */}
        <EarnTile
          id="leaderboards-section"
          title="Leaderboards"
          subtitle="Weekly & all-time"
          status="ready"
          reward="Bragging rights"
          actionLabel="View"
          icon="🏆"
          onAction={() => {}}
          expanded={false}
          onExpand={() => {}}
        >
          <Leaderboards />
        </EarnTile>

        {/* Badges Tile */}
        <EarnTile
          id="badges-section"
          title="Badges"
          subtitle="12 to collect"
          status="ready"
          reward="Up to 300k cr"
          actionLabel="View"
          icon="🏅"
          onAction={() => {}}
          expanded={false}
          onExpand={() => {}}
        >
          <Badges />
        </EarnTile>

        {/* Friends' Streaks Tile */}
        <EarnTile
          id="friends-streaks-section"
          title="Friends' Streaks"
          subtitle="Social leaderboard"
          status="ready"
          reward="Referral boost"
          actionLabel="View"
          icon="👥"
          onAction={() => {}}
          expanded={false}
          onExpand={() => {}}
        >
          <FriendsStreaks />
        </EarnTile>

        {/* Seasonal Events Tile */}
        <EarnTile
          id="seasonal-events-section"
          title="Seasonal Events"
          subtitle="Limited-time rewards"
          status="ready"
          reward="Exclusive cosmetics"
          actionLabel="View"
          icon="🎉"
          onAction={() => {}}
          expanded={false}
          onExpand={() => {}}
        >
          <SeasonalEvents />
        </EarnTile>
      </div>

      {/* COLLAPSED FOOTER */}
      <details id="promo-section" className="card group">
        <summary className="flex items-center justify-between p-4 cursor-pointer list-none">
          <span className="font-medium">More</span>
          <span className="text-[12px] text-muted">Promo · Redemptions · Rules</span>
        </summary>
        <div className="px-4 pb-4 pt-2 border-t border-line animate-slide-down space-y-6">
          {/* Promo redemption */}
          <div>
            <h3 className="text-[13px] font-semibold tracking-wide text-content uppercase mb-3">Redeem a promo code</h3>
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={redeem}>
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
              <p role={redeemStatus.kind === 'err' ? 'alert' : 'status'} className={`pt-2 text-[13px] ${redeemStatus.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
                {redeemStatus.message}
              </p>
            )}
          </div>

          {/* My redemptions */}
          <div>
            <h3 className="text-[13px] font-semibold tracking-wide text-content uppercase mb-3">Your redemptions</h3>
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
          </div>

          {/* Rules reference */}
          <div className="text-[12px] text-muted space-y-2">
            <p><strong>Check-in:</strong> +50,000 base · day 7 +500,000 · day 30 +2,000,000</p>
            <p><strong>Arcade:</strong> Typing 3×/day (80/50/0 WPM tiers) · Memory 2×/day (≤8/≤12/any moves)</p>
            <p><strong>Clear bonus:</strong> +7,000 cr for finishing both games · once daily</p>
            <p><strong>Referrals:</strong> +500,000 cr when friend hits 7 days or 200K pool tokens</p>
            <p><strong>Tasks:</strong> One-time rewards for specific actions (e.g., GitHub star)</p>
            <p><strong>All earning requires verified email.</strong></p>
          </div>
        </div>
      </details>

      {/* Arcade Panel (referenced by handleOpenArcade) */}
      {user && (
        <ArcadePanel
          onSessionStats={setArcadeStats}
        />
      )}
    </div>
  </>)
}