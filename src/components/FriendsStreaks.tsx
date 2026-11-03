import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Card } from './ui'

interface FriendStreak {
  user_id: string
  username: string
  avatar_url: string | null
  streak: number
  last_checkin: string | null
  referral_status: string
}

interface FriendsStreaksResponse {
  friends: FriendStreak[]
  your_streak: number
}

export default function FriendsStreaks() {
  const [data, setData] = useState<FriendsStreaksResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    api.get<FriendsStreaksResponse>('/referrals/friends-streaks')
      .then((res) => { if (mounted) { setData(res); setLoading(false) } })
      .catch(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  if (loading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-muted">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-hidden="true" />
          <span>Loading friends…</span>
        </div>
      </Card>
    )
  }

  if (!data || data.friends.length === 0) {
    return (
      <Card className="p-4 text-center">
        <div className="space-y-3">
          <span className="text-4xl" aria-hidden="true">👥</span>
          <h4 className="font-medium">No friends yet</h4>
          <p className="text-sm text-muted">
            Invite friends to see their streaks here and compete!
          </p>
        </div>
      </Card>
    )
  }

  // Sort by streak descending
  const sortedFriends = [...data.friends].sort((a, b) => b.streak - a.streak)

  return (
    <Card className="p-4 space-y-3" id="friends-streaks-section">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <span aria-hidden="true">👥</span>
          Friends' Streaks
        </h3>
        <span className="text-[11px] text-muted">Your streak: {data.your_streak} 🔥</span>
      </div>

      <div className="space-y-2" role="list" aria-label="Friends' streaks">
        {sortedFriends.map((friend, index) => (
          <div
            key={friend.user_id}
            className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
              index < 3 ? 'bg-accent/5 border border-accent/20' : 'hover:bg-surface-2'
            }`}
            role="listitem"
          >
            <span className={`w-8 text-center font-bold ${index < 3 ? 'text-accent' : 'text-muted'}`}>
              #{index + 1}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {friend.avatar_url ? (
                <img src={friend.avatar_url} alt="" className="w-7 h-7 rounded-full" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center text-[12px]" aria-hidden="true">
                  {friend.username[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <span className="font-medium text-sm truncate max-w-[120px]">{friend.username}</span>
              {friend.referral_status === 'paid' && (
                <span className="px-1.5 py-0.5 text-[9px] font-medium bg-gain/20 text-gain rounded-full">✓ Qualified</span>
              )}
              {friend.referral_status === 'waiting' && (
                <span className="px-1.5 py-0.5 text-[9px] font-medium bg-warn/20 text-warn rounded-full">Pending</span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2 text-right">
              <span className={`num font-bold ${friend.streak > 0 ? 'text-gain' : 'text-muted'}`}>
                {friend.streak > 0 ? friend.streak : '—'}
              </span>
              <span className="text-[11px] text-muted">🔥</span>
              {friend.last_checkin && (
                <span className="text-[10px] text-muted">
                  {new Date(friend.last_checkin).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] text-muted">
        Cheer on your friends! Their streak progress helps you both earn referral rewards.
      </p>
    </Card>
  )
}