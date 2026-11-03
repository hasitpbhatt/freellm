import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card } from './ui'
import { useHaptics } from '../lib/useHaptics'

interface Badge {
  id: string
  name: string
  description: string
  icon: string
  category: string
  tier: number
  reward: number
  earned: boolean
  earned_at: number | null
  notified: number
}

interface BadgesResponse {
  badges: Badge[]
}

const categoryOrder = ['streak', 'typing', 'memory', 'referral', 'pool', 'general']
const categoryLabels: Record<string, string> = {
  streak: 'Streaks',
  typing: 'Typing',
  memory: 'Memory',
  referral: 'Referrals',
  pool: 'Pool Usage',
  general: 'General',
}

export default function Badges() {
  const { pulse } = useHaptics()
  const [data, setData] = useState<BadgesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let mounted = true
    loadBadges()
    return () => { mounted = false }

    async function loadBadges() {
      setLoading(true)
      try {
        const res = await api.get<BadgesResponse>('/badges')
        if (mounted) setData(res)
      } catch {
        // Error handled by api interceptor
      } finally {
        if (mounted) setLoading(false)
      }
    }
  }, [])

  const handleCheck = async () => {
    setChecking(true)
    try {
      const res = await api.post<{ newly_earned: string[] }>('/badges/check', {})
      if (res.newly_earned.length > 0) {
        pulse('level')
        // Reload badges to show newly earned
        const updated = await api.get<BadgesResponse>('/badges')
        setData(updated)
      }
    } catch {
      // Error handled by api interceptor
    } finally {
      setChecking(false)
    }
  }

  const handleNotify = async (badgeId: string) => {
    try {
      await api.post(`/badges/${badgeId}/notify`, {})
      setData((prev) => prev ? {
        ...prev,
        badges: prev.badges.map(b => b.id === badgeId ? { ...b, notified: 1 } : b)
      } : null)
    } catch {
      // Ignore
    }
  }

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-muted">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <span>Loading badges…</span>
        </div>
      </Card>
    )
  }

  if (!data) return null

  // Group badges by category
  const grouped = data.badges.reduce((acc, badge) => {
    if (!acc[badge.category]) acc[badge.category] = []
    acc[badge.category].push(badge)
    return acc
  }, {} as Record<string, Badge[]>)

  const unnotifiedCount = data.badges.filter(b => b.earned && !b.notified).length

  return (
    <Card className="p-4 space-y-4" id="badges-section">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <span aria-hidden="true">🏅</span>
          Badges
          {unnotifiedCount > 0 && (
            <span className="px-2 py-0.5 text-2xs font-medium bg-gain/20 text-gain rounded-full animate-pulse">
              {unnotifiedCount} new
            </span>
          )}
        </h3>
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-2 border border-line hover:bg-surface-3 disabled:opacity-50"
          aria-label="Check for new badges"
        >
          {checking ? 'Checking…' : 'Check for new'}
        </button>
      </div>

      <div className="space-y-4" role="list" aria-label="Badge collection">
        {categoryOrder.map((cat) => {
          const badges = grouped[cat]
          if (!badges) return null
          return (
            <div key={cat} className="space-y-2">
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wide">{categoryLabels[cat]}</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" role="list">
                {badges.map((badge) => (
                  <div
                    key={badge.id}
                    className={`relative p-3 rounded-lg border transition-all ${
                      badge.earned
                        ? 'bg-gain/5 border-gain/30'
                        : 'bg-surface-2 border-line opacity-60'
                    }`}
                    role="listitem"
                  >
                    <div className="flex flex-col items-center gap-2 text-center">
                      <span className="text-3xl" aria-hidden="true">{badge.icon}</span>
                      <div className="flex items-center gap-1">
                        <h5 className={`font-medium text-sm ${badge.earned ? 'text-content' : 'text-muted'}`}>
                          {badge.name}
                        </h5>
                        {badge.tier > 1 && (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold bg-accent/20 text-accent rounded">
                            T{badge.tier}
                          </span>
                        )}
                      </div>
                      <p className={`text-xs ${badge.earned ? 'text-muted' : 'text-line'}`}>{badge.description}</p>
                      {badge.reward > 0 && (
                        <span className="num text-xs text-gain">+{(badge.reward / 1000).toFixed(0)}k cr</span>
                      )}
                    </div>

                    {badge.earned && !badge.notified && (
                      <button
                        type="button"
                        onClick={() => handleNotify(badge.id)}
                        className="absolute top-2 right-2 w-5 h-5 rounded-full bg-gain/20 text-gain flex items-center justify-center text-2xs hover:bg-gain/30"
                        aria-label={`Mark ${badge.name} as seen`}
                      >
                        ✓
                      </button>
                    )}

                    {!badge.earned && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-4xl opacity-20" aria-hidden="true">🔒</span>
                      </div>
                    )}

                    {badge.earned && badge.earned_at && (
                      <div className="absolute bottom-2 left-2 right-2 text-[9px] text-muted text-center">
                        Earned {new Date(badge.earned_at).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-center text-xs text-muted">
        Earn badges by completing challenges. Each badge gives a one-time credit bonus!
      </p>
    </Card>
  )
}