import { useEffect, useRef, useState } from 'react'
import { Button, Card, CardHeader } from './ui'
import { useHaptics } from '../lib/useHaptics'

// Inject component styles once
if (typeof document !== 'undefined' && !document.getElementById('today-card-styles')) {
  const style = document.createElement('style')
  style.id = 'today-card-styles'
  style.textContent = `
    /* Earn page — reward pulse animations */
    @media (prefers-reduced-motion: no-preference) {
      .reward-checkin .today-card__earned { animation: pulse-gain 0.6s ease-out; }
      .reward-game .arcade-card { animation: pulse-gain 0.6s ease-out; }
      .reward-level .today-card__level { animation: pulse-gain 0.6s ease-out; }
      .reward-referral .squad-tile { animation: pulse-gain 0.6s ease-out; }
    }
    @keyframes pulse-gain {
      0% { box-shadow: 0 0 0 0 var(--green); }
      50% { box-shadow: 0 0 0 8px var(--green); }
      100% { box-shadow: 0 0 0 0 transparent; }
    }
    /* Earn tile grid — single column on mobile */
    @media (max-width: 640px) {
      .earn-tile-grid { grid-template-columns: 1fr; }
      .today-card__cta { font-size: 0.8125rem; }
    }
    /* TodayCard streak ring animation */
    .today-card svg circle:nth-of-type(2) {
      transition: stroke-dashoffset 800ms ease-out;
    }
    @media (prefers-reduced-motion: reduce) {
      .today-card svg circle:nth-of-type(2) { transition: none !important; }
    }
  `
  document.head.appendChild(style)
}

interface TodayCardProps {
  id?: string
  streak: number
  checkedInToday: boolean
  todayReward: number
  earnedToday: number
  progress: {
    checkin: boolean
    typing: number
    memory: number
    clear: boolean
  }
  nextResetMs: number
  onCheckIn: () => void
  onOpenArcade: () => void
  streakFreezes: number
  freezeUsedToday?: boolean
}

export default function TodayCard({
  id,
  streak,
  checkedInToday,
  todayReward,
  earnedToday,
  progress,
  nextResetMs,
  onCheckIn,
  onOpenArcade,
  streakFreezes,
  freezeUsedToday,
}: TodayCardProps) {
  const { pulse } = useHaptics()
  const [msLeft, setMsLeft] = useState(() => nextResetMs - Date.now())
  const [showAchievements, setShowAchievements] = useState(false)
  const ringRef = useRef<SVGCircleElement>(null)

  // Countdown timer
  useEffect(() => {
    const id = setInterval(() => {
      setMsLeft((prev) => Math.max(0, prev - 30_000))
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  // Streak ring animation
  useEffect(() => {
    const circle = ringRef.current
    if (!circle) return
    const radius = 24
    const circumference = 2 * Math.PI * radius
    const pct = streak > 0 ? Math.min(1, (streak % 30) / 30) : 0
    circle.style.strokeDasharray = `${circumference} ${circumference}`
    circle.style.strokeDashoffset = circumference.toString()
    // Force reflow for animation
    circle.getBoundingClientRect()
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!prefersReduced) {
      circle.style.transition = 'stroke-dashoffset 800ms ease-out'
    }
    circle.style.strokeDashoffset = (circumference * (1 - pct)).toString()
  }, [streak])

  // Reward pulse listener
  useEffect(() => {
    const handlePulse = (e: CustomEvent) => {
      if (e.detail.kind === 'checkin') pulse('checkin')
    }
    window.addEventListener('earn-reward', handlePulse as EventListener)
    return () => window.removeEventListener('earn-reward', handlePulse as EventListener)
  }, [pulse])

  const hoursLeft = Math.ceil(msLeft / 3_600_000)
  const minsLeft = Math.ceil((msLeft % 3_600_000) / 60_000)
  const timeStr = msLeft > 3_600_000 ? `${hoursLeft}h` : `${minsLeft}m`

  const doneCount = [progress.checkin, progress.typing > 0, progress.memory > 0, progress.clear].filter(Boolean).length
  const totalCount = 4

  // First-visit hint
  const isFirstVisit = streak === 0 && !checkedInToday && earnedToday === 0

  // Achievements (client-side derived)
  const achievements = [
    streak >= 7 && { id: 'week', label: '🔥 Week Streak' },
    streak >= 30 && { id: 'month', label: '🏆 Month Streak' },
    progress.clear && { id: 'clear', label: '✨ Daily Clear' },
    earnedToday > 100_000 && { id: 'big-day', label: '💰 100k+ Day' },
  ].filter(Boolean) as { id: string; label: string }[]

  // Primary CTA state
  let ctaLabel: string
  let ctaVariant: 'primary' | 'secondary' | 'ghost' = 'primary'
  let ctaDisabled = false
  let ctaOnClick: () => void

  if (!checkedInToday) {
    ctaLabel = `Check in +${(todayReward / 1000).toFixed(0)}k`
    ctaOnClick = () => {
      onCheckIn()
      window.dispatchEvent(new CustomEvent('earn-reward', { detail: { kind: 'checkin' } }))
    }
  } else if (!progress.clear) {
    ctaLabel = 'Play Arcade'
    ctaVariant = 'secondary'
    ctaOnClick = onOpenArcade
  } else {
    ctaLabel = 'All done — come back tomorrow'
    ctaVariant = 'ghost'
    ctaDisabled = true
    ctaOnClick = () => {}
  }

  // Abbreviate earned today for mobile
  const earnedDisplay = earnedToday >= 10_000
    ? `◇${(earnedToday / 1000).toFixed(1)}k`
    : `◇${earnedToday.toLocaleString()}`

  return (
    <Card id={id} className="today-card">
      <CardHeader title="Today" action={<span className="num text-[11px] text-muted">UTC reset</span>} />

      <div className="p-4 flex flex-col gap-4">
        {/* Streak ring + earned today */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <svg width="56" height="56" className="shrink-0" viewBox="0 0 56 56" role="img" aria-label={`Streak: ${streak} days, ${timeStr} until reset`}>
                <circle
                  ref={ringRef}
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  stroke="var(--line)"
                  strokeWidth="4"
                  className="text-line"
                />
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="none"
                  stroke="var(--gain)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  className="text-gain"
                  style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}
                />
                <text x="28" y="30" textAnchor="middle" dominantBaseline="central" className="num text-[14px] font-bold fill-content" aria-hidden="true">
                  {streak}
                </text>
              </svg>
              {/* Streak freeze indicator */}
              {streakFreezes > 0 && (
                <div className="absolute -top-1 -right-1 flex items-center gap-1 bg-surface px-2 py-0.5 rounded-full border border-accent/30 shadow-lg" aria-label={`Streak freezes available: ${streakFreezes}`}>
                  <span className="text-[14px]" aria-hidden="true">❄️</span>
                  <span className="num text-[11px] font-bold text-accent">{streakFreezes}</span>
                </div>
              )}
            </div>
            <div>
              <p className="text-[12px] text-muted">Current streak</p>
              <p className="num text-2xl font-bold text-content">{streak}</p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <p className="num text-[12px] text-muted" aria-live="polite" aria-atomic="true">
              Resets in {timeStr}
            </p>
            <div className="flex items-baseline gap-1">
              <span className="num text-xl font-bold text-gain today-card__earned" aria-label={`Earned today: ${earnedToday.toLocaleString()} credits`}>
                {earnedDisplay}
              </span>
              <span className="text-[11px] text-muted">cr</span>
            </div>
          </div>
        </div>

        {/* Progress segments */}
        <div className="flex items-center gap-2" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={totalCount} aria-label={`Progress: ${doneCount} of ${totalCount} done`}>
          {[
            { key: 'checkin', done: progress.checkin, label: 'Check-in' },
            { key: 'typing', done: progress.typing > 0, label: 'Typing' },
            { key: 'memory', done: progress.memory > 0, label: 'Memory' },
            { key: 'clear', done: progress.clear, label: 'Clear' },
          ].map((seg) => (
            <div key={seg.key} className="flex flex-col items-center gap-1 flex-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors ${
                seg.done ? 'border-gain bg-gain/10' : 'border-line bg-surface-2'
              }`}>
                {seg.done ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-gain">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="num text-[10px] text-muted">{seg.key === 'checkin' ? '1' : seg.key === 'typing' ? '2' : seg.key === 'memory' ? '3' : '4'}</span>
                )}
              </div>
              <span className={`text-[10px] ${seg.done ? 'text-gain' : 'text-muted'}`}>{seg.label}</span>
            </div>
          ))}
        </div>

        {/* Primary CTA */}
        <Button
          className="today-card__cta w-full sm:w-auto sm:self-center"
          variant={ctaVariant}
          disabled={ctaDisabled}
          onClick={ctaOnClick}
          aria-label={ctaLabel}
        >
          {ctaLabel}
        </Button>

        {/* Streak at risk banner */}
        {streak > 0 && !checkedInToday && hoursLeft < 6 && (
          <div className="flex items-center gap-2 rounded-lg bg-warn/10 border border-warn/30 p-3 text-[12px] text-warn" role="alert">
            <span aria-hidden="true">⚠</span>
            <span className="flex-1">Streak at risk — {hoursLeft}h left to check in</span>
          </div>
        )}

        {/* Freeze used today banner */}
        {freezeUsedToday && (
          <div className="flex items-center gap-2 rounded-lg bg-accent/10 border border-accent/30 p-3 text-[12px] text-accent" role="status">
            <span aria-hidden="true">❄️</span>
            <span className="flex-1">Streak freeze used — your streak was saved!</span>
          </div>
        )}

        {/* First visit hint */}
        {isFirstVisit && (
          <p className="text-[13px] text-muted text-center">
            Start your streak → check in, play 2 arcade games, earn the clear bonus.
          </p>
        )}

        {/* Achievements */}
        {achievements.length > 0 && (
          <details className="group" open={showAchievements} onToggle={() => setShowAchievements(!showAchievements)}>
            <summary className="flex items-center gap-2 cursor-pointer list-none text-[12px] text-muted">
              <span>Achievements</span>
              <span className="num">{achievements.length}</span>
              <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="flex flex-wrap gap-2 mt-2 animate-slide-down">
              {achievements.map((a) => (
                <span key={a.id} className="px-2 py-1 rounded-full bg-gain/10 text-gain text-[11px] font-medium">{a.label}</span>
              ))}
            </div>
          </details>
        )}

        {/* Day 7 Streak Chest teaser */}
        {streak > 0 && streak < 7 && !progress.clear && (
          <p className="text-[12px] text-muted text-center">
            Day 7 → Streak Chest (500k cr + title)
          </p>
        )}
      </div>
    </Card>
  )
}