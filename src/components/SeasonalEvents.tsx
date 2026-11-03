import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card, Button } from './ui'
import { useHaptics } from '../lib/useHaptics'

interface SeasonalEvent {
  id: string
  name: string
  description: string
  icon: string
  banner_color: string
  start_at: number
  end_at: number
  config: {
    quests?: Array<{ id: string; name: string; description: string; target: number; reward: number }>
    multipliers?: Record<string, number>
    cosmetics?: Array<{ id: string; name: string; type: string }>
  }
  cosmetics?: Array<{
    id: string
    name: string
    type: string
    description: string
    icon: string
    unlock_criteria: any
    unlocked: boolean
    equipped: boolean
  }>
}

interface EventParticipation {
  progress: Record<string, number>
  rewards_claimed: string[]
  joined_at: number
}

interface EventsResponse {
  events: SeasonalEvent[]
}

interface EventDetailResponse {
  event: SeasonalEvent
  participation: EventParticipation | null
}

export default function SeasonalEvents() {
  const { pulse } = useHaptics()
  const [events, setEvents] = useState<SeasonalEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<SeasonalEvent | null>(null)
  const [participation, setParticipation] = useState<EventParticipation | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState<string | null>(null)
  const [claiming, setClaiming] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    api.get<EventsResponse>('/seasonal-events')
      .then((res) => { if (mounted) { setEvents(res.events); setLoading(false) } })
      .catch(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  const handleSelectEvent = async (event: SeasonalEvent) => {
    try {
      const res = await api.get<EventDetailResponse>(`/seasonal-events/${event.id}`)
      setSelectedEvent(res.event)
      setParticipation(res.participation)
    } catch {
      setSelectedEvent(event)
      setParticipation(null)
    }
  }

  const handleJoin = async (eventId: string) => {
    setJoining(eventId)
    try {
      await api.post(`/seasonal-events/${eventId}/join`, {})
      pulse('level')
      if (selectedEvent?.id === eventId) {
        const res = await api.get<EventDetailResponse>(`/seasonal-events/${eventId}`)
        setParticipation(res.participation)
      }
    } catch {
      // Error handled by api interceptor
    } finally {
      setJoining(null)
    }
  }

  const handleClaim = async (eventId: string, questId: string) => {
    setClaiming(questId)
    try {
      await api.post(`/seasonal-events/${eventId}/quest/${questId}/claim`, {})
      pulse('level')
      if (selectedEvent?.id === eventId) {
        const res = await api.get<EventDetailResponse>(`/seasonal-events/${eventId}`)
        setParticipation(res.participation)
      }
    } catch {
      // Error handled by api interceptor
    } finally {
      setClaiming(null)
    }
  }

  const handleCosmeticToggle = async (cosmeticId: string, equip: boolean) => {
    try {
      await api.post(`/cosmetics/${cosmeticId}/equip`, { equip })
      if (selectedEvent) {
        setSelectedEvent({
          ...selectedEvent,
          cosmetics: selectedEvent.cosmetics?.map(c =>
            c.id === cosmeticId ? { ...c, equipped: equip } : c
          ) ?? [],
        })
      }
    } catch {
      // Error handled by api interceptor
    }
  }

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-muted">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <span>Loading events…</span>
        </div>
      </Card>
    )
  }

  if (events.length === 0) {
    return (
      <Card className="p-6 text-center" id="seasonal-events-section">
        <div className="space-y-3">
          <span className="text-4xl" aria-hidden="true">🎉</span>
          <h4 className="font-medium">No active events</h4>
          <p className="text-sm text-muted">
            Seasonal events appear here during holidays and special occasions.
            Check back for limited-time quests and exclusive rewards!
          </p>
        </div>
      </Card>
    )
  }

  // If an event is selected, show detail view
  if (selectedEvent) {
    const event = selectedEvent
    const quests = event.config.quests ?? []
    const cosmetics = event.cosmetics ?? []

    return (
      <Card className="p-4 space-y-4" id="seasonal-events-section" style={{ borderColor: event.banner_color }}>
        <button
          type="button"
          onClick={() => { setSelectedEvent(null); setParticipation(null) }}
          className="absolute top-3 right-3 p-1 rounded-lg hover:bg-surface-2 text-muted"
          aria-label="Back to events"
        >
          ←
        </button>

        <div className="flex items-center gap-3" style={{ background: event.banner_color, opacity: 0.15 }} role="banner">
          <span className="text-3xl" aria-hidden="true">{event.icon}</span>
          <div>
            <h3 className="font-bold text-lg">{event.name}</h3>
            <p className="text-sm text-muted">{event.description}</p>
          </div>
          <div className="ml-auto text-right text-xs text-muted">
            Ends {new Date(event.end_at).toLocaleDateString()}
          </div>
        </div>

        {participation ? (
          <>
            <div className="space-y-2" role="list" aria-label="Event quests">
              {quests.map((quest) => {
                const progress = participation.progress[quest.id] ?? 0
                const claimed = participation.rewards_claimed.includes(quest.id)
                const completed = progress >= quest.target
                const pct = Math.min(100, Math.round((progress / quest.target) * 100))

                return (
                  <div
                    key={quest.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      claimed ? 'bg-gain/5 border-gain/30' : completed ? 'bg-accent/5 border-accent/30' : 'bg-surface-2 border-line'
                    }`}
                    role="listitem"
                  >
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm">{quest.name}</h4>
                      <p className="text-xs text-muted">{quest.description}</p>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-full transition-all duration-300 ${claimed ? 'bg-gain' : completed ? 'bg-accent' : 'bg-muted'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted">{progress.toLocaleString()} / {quest.target.toLocaleString()}</span>
                        <span className="num text-xs font-bold text-gain">+{(quest.reward / 1000).toFixed(0)}k cr</span>
                      </div>
                    </div>

                    {completed && !claimed && (
                      <Button
                        size="sm"
                        onClick={() => handleClaim(event.id, quest.id)}
                        disabled={claiming === quest.id}
                        className="shrink-0"
                      >
                        {claiming === quest.id ? 'Claiming…' : 'Claim'}
                      </Button>
                    )}
                    {claimed && (
                      <span className="px-2 py-1 text-xs font-medium bg-gain/20 text-gain rounded-full shrink-0">Claimed</span>
                    )}
                  </div>
                )
              })}
            </div>

            {cosmetics.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-line">
                <h4 className="font-medium text-sm">Event Cosmetics</h4>
                <div className="flex flex-wrap gap-2" role="list">
                  {cosmetics.map((cosmetic) => (
                    <div
                      key={cosmetic.id}
                      className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                        cosmetic.equipped ? 'bg-accent/10 border-accent/30' : cosmetic.unlocked ? 'bg-surface-2 border-line' : 'bg-surface-2 border-line opacity-50'
                      }`}
                      role="listitem"
                    >
                      <span className="text-xl" aria-hidden="true">{cosmetic.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-sm">{cosmetic.name}</span>
                          {cosmetic.equipped && <span className="px-1.5 py-0.5 text-[9px] font-bold bg-accent/20 text-accent rounded">Equipped</span>}
                          {cosmetic.unlocked && !cosmetic.equipped && <span className="px-1.5 py-0.5 text-[9px] font-medium bg-gain/20 text-gain rounded">Unlocked</span>}
                          {!cosmetic.unlocked && <span className="px-1.5 py-0.5 text-[9px] font-medium text-muted">Locked</span>}
                        </div>
                        <p className="text-xs text-muted">{cosmetic.description}</p>
                      </div>
                      {cosmetic.unlocked && (
                        <Button
                          size="sm"
                          variant={cosmetic.equipped ? 'secondary' : 'primary'}
                          onClick={() => handleCosmeticToggle(cosmetic.id, !cosmetic.equipped)}
                          className="shrink-0"
                        >
                          {cosmetic.equipped ? 'Unequip' : 'Equip'}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-muted mb-3">Join this event to participate in quests and earn exclusive rewards!</p>
            <Button onClick={() => handleJoin(event.id)} disabled={joining === event.id}>
              {joining === event.id ? 'Joining…' : 'Join Event'}
            </Button>
          </div>
        )}
      </Card>
    )
  }

  // List view
  return (
    <Card className="p-4 space-y-3" id="seasonal-events-section">
      <h3 className="font-semibold flex items-center gap-2">
        <span aria-hidden="true">🎉</span>
        Seasonal Events
      </h3>

      <div className="space-y-2" role="list" aria-label="Active seasonal events">
        {events.map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => handleSelectEvent(event)}
            className={`w-full text-left p-3 rounded-lg border transition-colors flex items-center gap-3 ${
              event.banner_color ? `border-${event.banner_color.replace('#', '')}/30` : 'hover:bg-surface-2 border-line'
            }`}
            role="listitem"
          >
            <span className="text-2xl" aria-hidden="true">{event.icon}</span>
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate">{event.name}</h4>
              <p className="text-xs text-muted truncate">{event.description}</p>
            </div>
            <span className="text-xs text-muted shrink-0">
              Ends {new Date(event.end_at).toLocaleDateString()}
            </span>
          </button>
        ))}
      </div>
    </Card>
  )
}