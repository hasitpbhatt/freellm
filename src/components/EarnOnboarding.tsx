import { useEffect, useState } from 'react'
import { Button, Card } from './ui'
import { useHaptics } from '../lib/useHaptics'

const ONBOARDING_DONE_KEY = 'freellm_earn_onboarding_done'

const steps = [
  {
    id: 'checkin',
    title: 'Daily check-in',
    description: 'Tap once a day → +50,000 credits. Streak bonuses at day 7 (+500k) and day 30 (+2M).',
    cta: 'Check in now',
    highlight: 'today-card',
  },
  {
    id: 'arcade',
    title: 'Arcade games',
    description: 'Skill-based earnings: Typing (3×/day) up to 10k, Memory (2×/day) up to 12k. Clear both → +7k bonus.',
    cta: 'Play Arcade',
    highlight: 'arcade-section',
  },
  {
    id: 'referral',
    title: 'Invite friends',
    description: 'Share your link. When they hit 7-day streak or 200k Pool tokens, you both get 500,000 credits.',
    cta: 'Copy link',
    highlight: 'referral-section',
  },
]

export default function EarnOnboarding({ onComplete, onSkip }: { onComplete: () => void; onSkip: () => void }) {
  const { pulse } = useHaptics()
  const [stepIndex, setStepIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_DONE_KEY)
    if (done) {
      setDismissed(true)
      onSkip()
    }
  }, [onSkip])

  if (dismissed) return null

  const step = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1

  const handleNext = () => {
    pulse('checkin')
    if (isLast) {
      localStorage.setItem(ONBOARDING_DONE_KEY, 'true')
      onComplete()
    } else {
      setStepIndex((i) => i + 1)
    }
  }

  const handleAction = () => {
    const target = document.getElementById(step.highlight)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Highlight briefly
    target?.classList.add('onboard-highlight')
    setTimeout(() => target?.classList.remove('onboard-highlight'), 2000)
  }

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, 'true')
    onSkip()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <Card className="max-w-md w-full animate-slide-up">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 id="onboarding-title" className="text-lg font-semibold">Welcome to Earn</h2>
            <button onClick={handleSkip} className="text-muted hover:text-content" aria-label="Skip onboarding">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2" aria-label={`Step ${stepIndex + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <span
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${i <= stepIndex ? 'bg-accent' : 'bg-surface-3'}`}
                aria-hidden="true"
              />
            ))}
          </div>

          <div className="text-center space-y-3">
            <div className="text-[28px]" aria-hidden="true">
              {step.id === 'checkin' && '🔥'}
              {step.id === 'arcade' && '🎮'}
              {step.id === 'referral' && '👥'}
            </div>
            <h3 className="text-xl font-semibold">{step.title}</h3>
            <p className="text-sm text-muted">{step.description}</p>
          </div>

          <div className="flex flex-col gap-3">
            <Button className="w-full" onClick={handleAction} variant="primary">
              {step.cta}
            </Button>
            {isLast ? (
              <Button variant="ghost" onClick={handleNext} className="w-full">
                Got it — start earning
              </Button>
            ) : (
              <Button variant="secondary" onClick={handleNext} className="w-full">
                Next
              </Button>
            )}
          </div>

          <p className="text-center text-xs text-muted">
            {stepIndex + 1} of {steps.length} • <button onClick={handleSkip} className="text-accent hover:underline">Skip</button>
          </p>
        </div>
      </Card>
    </div>
  )
}