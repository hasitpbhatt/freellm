import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card } from './ui'
import { useHaptics } from '../lib/useHaptics'

interface WeeklyQuest {
  id: string
  slug: string
  title: string
  description: string
  target: number
  reward: number
  type: string
  current: number
  completed: number
  claimed: boolean
  progress_pct: number
}

interface WeeklyQuestsResponse {
  week_start: number
  week_end: number
  quests: WeeklyQuest[]
}

export default function WeeklyQuests() {
  const { pulse } = useHaptics()
  const [data, setData] = useState<WeeklyQuestsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [claiming, setClaiming] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    api.get<WeeklyQuestsResponse>('/weekly-quests')
      .then((res) => { if (mounted) { setData(res); setLoading(false) } })
      .catch(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  const handleClaim = async (quest: WeeklyQuest) => {
    setClaiming(quest.id)
    try {
      await api.post(`/weekly-quests/${quest.id}/claim`, {})
      pulse('level')
      setData((prev) => prev ? { ...prev, quests: prev.quests.map(q => q.id === quest.id ? { ...q, claimed: true } : q) } : null)
    } catch {
      // Error handled by api interceptor
    } finally {
      setClaiming(null)
    }
  }

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-muted">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <span>Loading weekly quests…</span>
        </div>
      </Card>
    )
  }

  if (!data || data.quests.length === 0) {
    return (
      <Card className="p-4 text-center text-muted">
        No weekly quests available right now. Check back on Monday!
      </Card>
    )
  }

  const weekEndDate = new Date(data.week_end)
  const weekEndStr = weekEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <Card className="p-4 space-y-3" id="weekly-quests-section">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <span aria-hidden="true">📋</span>
          Weekly Quests
        </h3>
        <span className="text-[11px] text-muted">Ends {weekEndStr}</span>
      </div>

      <div className="space-y-2" role="list" aria-label="Weekly quests">
        {data.quests.map((quest) => (
          <div
            key={quest.id}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              quest.claimed ? 'bg-gain/5 border-gain/30' : 'bg-surface-2 border-line'
            }`}
            role="listitem"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-medium text-sm truncate">{quest.title}</h4>
                {quest.claimed && (
                  <span className="px-2 py-0.5 text-[10px] font-medium bg-gain/20 text-gain rounded-full">Claimed</span>
                )}
                {quest.completed && !quest.claimed && (
                  <span className="px-2 py-0.5 text-[10px] font-medium bg-accent/20 text-accent rounded-full animate-pulse">Ready to claim</span>
                )}
              </div>
              <p className="text-[12px] text-muted truncate">{quest.description}</p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={quest.progress_pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${quest.title} progress`}>
                <div
                  className={`h-full transition-all duration-300 ${
                    quest.claimed ? 'bg-gain' : quest.completed ? 'bg-accent' : 'bg-muted'
                  }`}
                  style={{ width: `${quest.progress_pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-muted">
                  {quest.current.toLocaleString()} / {quest.target.toLocaleString()}
                </span>
                <span className="num text-[12px] font-bold text-gain">+{(quest.reward / 1000).toFixed(0)}k cr</span>
              </div>
            </div>

            {quest.completed && !quest.claimed && (
              <button
                type="button"
                onClick={() => handleClaim(quest)}
                disabled={claiming === quest.id}
                className="shrink-0 px-4 py-2 rounded-lg bg-accent text-accent-fg font-medium text-[13px] hover:opacity-90 disabled:opacity-50 min-w-[100px]"
                aria-label={`Claim ${quest.reward.toLocaleString()} credits for ${quest.title}`}
              >
                {claiming === quest.id ? 'Claiming…' : 'Claim'}
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] text-muted">
        Quests rotate every Monday 00:00 UTC. Complete them during the week to earn bonus credits!
      </p>
    </Card>
  )
}