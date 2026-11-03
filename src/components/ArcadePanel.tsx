import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'
import TypingGame from './TypingGame'
import MemoryGame from './MemoryGame'

type ClearState = {
  done: boolean
  ready: boolean
  reward: number
  needs: ('typing' | 'memory')[]
}

type LevelState = {
  level: number
  xp: number
  max_level: number
  next_xp: number | null
  pending: { level: number; reward: number } | null
}

// Session stats for EarnTile
export interface ArcadeSessionStats {
  typingPlaysUsed: number
  memoryPlaysUsed: number
  bestWpm: number | null
  bestMemoryMoves: number | null
}

interface ArcadePanelProps {
  onSessionStats?: (stats: ArcadeSessionStats) => void
}

// The arcade: skill games with bounded payouts, effort-proportional rewards.
// Typing and memory match — both require real skill, no reflex games.
export default function ArcadePanel({ onSessionStats }: ArcadePanelProps) {
  const [clear, setClear] = useState<ClearState | null>(null)
  const [level, setLevel] = useState<LevelState | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimingLevel, setClaimingLevel] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await api.get<{
        clear: ClearState
        level: LevelState
        games: Record<string, { plays_left: number; plays_cap: number }>
        typing_tiers: { min_wpm: number; reward: number }[]
        memory_tiers: { max_moves: number; reward: number }[]
      }>('/games/status')
      setClear(s.clear)
      setLevel(s.level)

      // Derive session stats
      const typingUsed = (s.games.typing?.plays_cap ?? 3) - (s.games.typing?.plays_left ?? 3)
      const memoryUsed = (s.games.memory?.plays_cap ?? 2) - (s.games.memory?.plays_left ?? 2)

      // Best WPM/moves would need history — for now derive from tiers achieved
      // (could be enhanced with /api/games/records in Phase 2)
      onSessionStats?.({
        typingPlaysUsed: typingUsed,
        memoryPlaysUsed: memoryUsed,
        bestWpm: null,
        bestMemoryMoves: null,
      })
    } catch {
      // games stay playable; trackers just show unknown
    }
  }, [onSessionStats])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- arcade status load on mount
    void load()
  }, [load])

  async function claimClear() {
    setClaiming(true)
    try {
      const data = await api.post<{ reward: number; balance: number }>('/games/clear/claim')
      setMessage({ kind: 'ok', text: `Arcade cleared — +${data.reward} cr. Balance ${data.balance.toLocaleString('en-US')} cr.` })
      window.dispatchEvent(new CustomEvent('earn-reward', { detail: { kind: 'game' } }))
      await load()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'Claim failed.' })
    } finally {
      setClaiming(false)
    }
  }

  async function claimLevel(lv: number) {
    setClaimingLevel(true)
    try {
      const data = await api.post<{ level: number; reward: number; balance: number }>('/games/level/claim', { level: lv })
      setMessage({ kind: 'ok', text: `Level ${data.level} reached — +${data.reward} cr. Balance ${data.balance.toLocaleString('en-US')} cr.` })
      window.dispatchEvent(new CustomEvent('earn-reward', { detail: { kind: 'level' } }))
      await load()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'Claim failed.' })
    } finally {
      setClaimingLevel(false)
    }
  }

  return (
    <div className="flex flex-col gap-4" id="arcade-section">
      {/* Level claim banner (only shows when pending) */}
      {level?.pending && (
        <Card className="border-gain/30 bg-gain/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center p-4">
            <p className="text-[13px] text-gain">Level {level.pending.level} earned — claim it.</p>
            <Button disabled={claimingLevel} onClick={() => void claimLevel(level.pending!.level)} className="w-full sm:w-auto">
              {claimingLevel ? 'Claiming…' : `Claim +${level.pending.reward} cr`}
            </Button>
          </div>
        </Card>
      )}

      {/* Clear bonus claim banner (only shows when ready) */}
      {clear?.ready && !clear.done && (
        <Card className="border-gain/30 bg-gain/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center p-4">
            <p className="text-[13px] text-gain">All games finished today — claim the clear bonus.</p>
            <Button disabled={claiming} onClick={() => void claimClear()} className="w-full sm:w-auto">
              {claiming ? 'Claiming…' : `Claim +${clear.reward} cr`}
            </Button>
          </div>
        </Card>
      )}

      {/* Message toast */}
      {message && (
        <p role={message.kind === 'err' ? 'alert' : 'status'} className={`text-[13px] ${message.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
          {message.text}
        </p>
      )}

      {/* Game cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <TypingGame />
        <MemoryGame />
      </div>
    </div>
  )
}