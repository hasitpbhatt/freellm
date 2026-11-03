import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card } from './ui'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui'

interface LeaderboardEntry {
  user_id: string
  username: string
  avatar_url: string | null
  best_wpm?: number
  best_moves?: number
  streak?: number
  qualified_count?: number
  achieved_at?: number
}

interface LeaderboardResponse {
  week_start?: number
  entries: LeaderboardEntry[]
}

type LeaderboardType = 'typing' | 'memory' | 'streak' | 'referrals'

const leaderboardConfig: Record<LeaderboardType, {
  label: string
  icon: string
  endpoint: string
  valueKey: keyof LeaderboardEntry
  valueLabel: string
  higherIsBetter: boolean
}> = {
  typing: { label: 'Typing WPM', icon: '⌨️', endpoint: '/leaderboards/typing', valueKey: 'best_wpm', valueLabel: 'WPM', higherIsBetter: true },
  memory: { label: 'Memory Moves', icon: '🧠', endpoint: '/leaderboards/memory', valueKey: 'best_moves', valueLabel: 'moves', higherIsBetter: false },
  streak: { label: 'Streak', icon: '🔥', endpoint: '/leaderboards/streak', valueKey: 'streak', valueLabel: 'days', higherIsBetter: true },
  referrals: { label: 'Referrals', icon: '👥', endpoint: '/leaderboards/referrals', valueKey: 'qualified_count', valueLabel: 'refs', higherIsBetter: true },
}

export default function Leaderboards() {
  const [activeTab, setActiveTab] = useState<LeaderboardType>('typing')
  const [data, setData] = useState<Record<LeaderboardType, LeaderboardEntry[]>>({
    typing: [], memory: [], streak: [], referrals: []
  })
  const [loading, setLoading] = useState(false)
  const [weekStart, setWeekStart] = useState<number | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    api.get<LeaderboardResponse>(leaderboardConfig[activeTab].endpoint)
      .then((res) => {
        if (mounted) {
          setData((prev) => ({ ...prev, [activeTab]: res.entries }))
          if (res.week_start) setWeekStart(res.week_start)
        }
      })
      .catch(() => {
        if (mounted) setData((prev) => ({ ...prev, [activeTab]: [] }))
      })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [activeTab])

  const entries = data[activeTab] || []
  const config = leaderboardConfig[activeTab]

  return (
    <Card className="p-4 space-y-4" id="leaderboards-section">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <span aria-hidden="true">🏆</span>
          Leaderboards
        </h3>
        {weekStart && (
          <span className="text-xs text-muted">
            Week of {new Date(weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as LeaderboardType)} className="w-full">
        <TabsList className="grid grid-cols-4 bg-surface-2 p-1" aria-label="Leaderboard categories">
          {(Object.entries(leaderboardConfig) as [LeaderboardType, typeof leaderboardConfig[LeaderboardType]][]).map(([key, cfg]) => (
            <TabsTrigger key={key} value={key} className="text-xs py-2">
              <span className="flex items-center justify-center gap-1">
                <span aria-hidden="true">{cfg.icon}</span>
                <span>{cfg.label}</span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {(Object.keys(leaderboardConfig) as LeaderboardType[]).map((key) => (
          <TabsContent key={key} value={key} className="mt-3 animate-fade-in">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted">
                <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                <span className="ml-2">Loading…</span>
              </div>
            ) : entries.length === 0 ? (
              <p className="text-center text-muted py-8">No entries yet — be the first!</p>
            ) : (
              <div className="space-y-1 max-h-[400px] overflow-auto" role="list" aria-label={`${config.label} leaderboard`}>
                {entries.slice(0, 50).map((entry, index) => (
                  <div
                    key={entry.user_id}
                    className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
                      index < 3 ? 'bg-accent/5 border border-accent/20' : 'hover:bg-surface-2'
                    }`}
                    role="listitem"
                  >
                    <span className={`w-8 text-center font-bold ${index < 3 ? 'text-accent' : 'text-muted'}`}>
                      #{index + 1}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {entry.avatar_url ? (
                        <img src={entry.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center text-xs" aria-hidden="true">
                          {entry.username[0]?.toUpperCase() ?? '?'}
                        </div>
                      )}
                      <span className="font-medium text-sm truncate max-w-[150px]">{entry.username}</span>
                    </div>
                    <div className="ml-auto flex items-center gap-2 text-right">
                      <span className={`num font-bold ${index < 3 ? 'text-accent' : 'text-content'}`}>
                        {entry[config.valueKey]?.toLocaleString() ?? '—'}
                      </span>
                      <span className="text-xs text-muted">{config.valueLabel}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <p className="text-center text-xs text-muted">
        Leaderboards update weekly. Play arcade games, maintain your streak, and invite friends to climb the ranks!
      </p>
    </Card>
  )
}