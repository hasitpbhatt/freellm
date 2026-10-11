import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card, CardHeader } from '../components/ui'
import ReactionGame from './ReactionGame'
import TypingGame from './TypingGame'
import TapsGame from './TapsGame'

type ClearState = {
  done: boolean
  ready: boolean
  reward: number
  needs: ('reaction' | 'typing' | 'taps')[]
}

type LevelState = {
  level: number
  xp: number
  max_level: number
  next_xp: number | null
  pending: { level: number; reward: number } | null
}

const GAME_LABELS: Record<string, string> = { reaction: 'Daily sprint', typing: 'Typing sprint', taps: 'Tap frenzy' }

// The arcade: three 10-second skill games plus a daily-clear bonus for
// finishing all three. Progress is always visible; the bonus states exactly
// what remains. Max haul per day is bounded by the per-game caps + 150cr.
export default function ArcadePanel() {
  const [clear, setClear] = useState<ClearState | null>(null)
  const [level, setLevel] = useState<LevelState | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [claimingLevel, setClaimingLevel] = useState(false)

  const load = useCallback(async () => {
    try {
      const s = await api.get<{ clear: ClearState; level: LevelState }>('/games/status')
      setClear(s.clear)
      setLevel(s.level)
    } catch {
      // games stay playable; trackers just show unknown
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function claimClear() {
    setClaiming(true)
    try {
      const data = await api.post<{ reward: number; balance: number }>('/games/clear/claim')
      setMessage({ kind: 'ok', text: `Arcade cleared — +${data.reward} cr. Balance ${data.balance.toLocaleString('en-US')} cr.` })
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
      await load()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof ApiError ? err.message : 'Claim failed.' })
    } finally {
      setClaimingLevel(false)
    }
  }

  const levelPct = level && level.next_xp !== null
    ? Math.min(100, Math.round((level.xp / level.next_xp) * 100))
    : 100

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title={`Arcade — level ${level?.level ?? 1}`}
          action={<span className="num text-[12px] text-muted" role="status">{level ? `${level.xp} XP` : '…'}</span>}
        />
        <div className="flex flex-col gap-2 p-4">
          {level === null ? (
            <p className="text-[13px] text-muted" role="status">Checking level…</p>
          ) : level.pending ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-gain">Level {level.pending.level} earned — claim it.</p>
              <Button size="sm" disabled={claimingLevel} onClick={() => void claimLevel(level.pending!.level)}>
                {claimingLevel ? 'Claiming…' : `Claim +${level.pending.reward} cr`}
              </Button>
            </div>
          ) : level.next_xp !== null ? (
            <>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-valuenow={levelPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Level ${level.level} progress: ${level.xp} of ${level.next_xp} XP to level ${level.level + 1}`}
              >
                <div className="h-full bg-accent" style={{ width: `${levelPct}%` }} />
              </div>
              <p className="num text-[12px] text-muted" role="status">
                {level.xp}/{level.next_xp} XP to level {level.level + 1} — earn 1 XP per 10 arcade credits
              </p>
            </>
          ) : (
            <p className="text-[13px] text-gain" role="status">Max level {level.max_level} — arcade master. 🏆</p>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Arcade clear bonus"
          action={<span className="num text-[12px] text-muted">+150 cr · once a day</span>}
        />
        <div className="flex flex-col gap-2 p-4">
          {clear === null ? (
            <p className="text-[13px] text-muted" role="status">Checking today's progress…</p>
          ) : clear.done ? (
            <p className="text-[13px] text-gain" role="status">Cleared today — all three games finished. Come back tomorrow.</p>
          ) : clear.ready ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[13px] text-gain">All three games finished today — claim it.</p>
              <Button size="sm" disabled={claiming} onClick={() => void claimClear()}>
                {claiming ? 'Claiming…' : 'Claim +150 cr'}
              </Button>
            </div>
          ) : (
            <p className="text-[13px] text-muted" role="status">
              Finish {clear.needs.map((g) => GAME_LABELS[g]).join(', ')} today to unlock the +150 cr clear bonus.
            </p>
          )}
          {message && (
            <p role={message.kind === 'err' ? 'alert' : 'status'} className={`text-[13px] ${message.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
              {message.text}
            </p>
          )}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <ReactionGame />
        <TypingGame />
        <TapsGame />
      </div>
    </div>
  )
}
