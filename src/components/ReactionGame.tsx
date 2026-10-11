import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card, CardHeader } from '../components/ui'

type Status = {
  plays_left: number
  plays_cap: number
  earned_today: number
  tiers: { within_ms: number; reward: number }[]
  min_ms: number
}

type Phase =
  | { name: 'idle' }
  | { name: 'arming' }
  | { name: 'ready'; shownAt: number }
  | { name: 'done'; text: string; kind: 'ok' | 'err' }

// Reaction sprint: wait for green, tap fast. One button, three labeled states,
// fouls forgiven with no penalty. Server validates timing and pays bounded
// credits (see functions/routes/games.ts for the tokenomics).
export default function ReactionGame() {
  const [status, setStatus] = useState<Status | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [roundId, setRoundId] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const load = async () => {
    try {
      setStatus(await api.get<Status>('/games/reaction/status'))
    } catch {
      // signed-out or failed — the section below handles display
    }
  }

  useEffect(() => {
    void load()
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const cancelTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  async function start() {
    cancelTimer()
    try {
      const data = await api.post<{ round_id: string }>('/games/reaction/start')
      setRoundId(data.round_id)
      setPhase({ name: 'arming' })
      // Random delay so anticipation can't be pre-timed.
      timer.current = window.setTimeout(() => {
        timer.current = null
        setPhase({ name: 'ready', shownAt: performance.now() })
      }, 1500 + Math.random() * 2500)
    } catch (err) {
      setPhase({
        name: 'done',
        kind: 'err',
        text: err instanceof ApiError ? err.message : 'Could not start a round.',
      })
    }
  }

  async function tap() {
    if (phase.name === 'arming') {
      // Foul: no penalty, round abandoned server-side by TTL.
      cancelTimer()
      setRoundId(null)
      setPhase({ name: 'done', kind: 'err', text: 'Too soon! Wait for green, then tap. No penalty — try again.' })
      return
    }
    if (phase.name !== 'ready' || !roundId) return
    const ms = Math.round(performance.now() - phase.shownAt)
    const id = roundId
    setRoundId(null)
    setPhase({ name: 'idle' })
    try {
      const data = await api.post<{ reward: number; reaction_ms: number; balance: number }>('/games/reaction/claim', {
        round_id: id,
        reaction_ms: ms,
      })
      setPhase({ name: 'done', kind: 'ok', text: `${data.reaction_ms}ms — +${data.reward} cr. Balance ${data.balance.toLocaleString('en-US')} cr.` })
      await load()
    } catch (err) {
      setPhase({
        name: 'done',
        kind: 'err',
        text: err instanceof ApiError ? err.message : 'Claim failed.',
      })
      await load()
    }
  }

  return (
    <Card>
      <CardHeader
        title="Daily sprint — reaction game"
        action={
          <span className="num text-[12px] text-muted" role="status">
            {status ? `${status.plays_left}/${status.plays_cap} paid plays left today` : '…'}
          </span>
        }
      />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[13px] text-muted">
          Wait for green, then tap as fast as you can. Under 180ms pays 50 cr, under 300ms pays 25 cr,
          anything human pays 10 cr — 5 paid plays a day, one shared daily pot.
        </p>
        {phase.name === 'idle' && (
          <Button onClick={() => void start()} className="w-full sm:w-auto sm:self-start">
            Start round
          </Button>
        )}
        {phase.name === 'arming' && (
          <button
            onClick={() => void tap()}
            className="min-h-[152px] touch-manipulation select-none rounded-lg border border-loss/40 bg-loss/10 p-6 text-center text-[15px] font-semibold text-loss"
            aria-label="Wait for green — tapping now is a foul"
          >
            Wait for green…
          </button>
        )}
        {phase.name === 'ready' && (
          <button
            onClick={() => void tap()}
            className="min-h-[152px] touch-manipulation select-none rounded-lg border border-gain/40 bg-gain/10 p-6 text-center text-[15px] font-semibold text-gain"
            aria-label="Tap now"
          >
            TAP NOW
          </button>
        )}
        {phase.name === 'done' && (
          <div className="flex flex-col items-start gap-2">
            <p role="status" className={`text-[13px] ${phase.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
              {phase.text}
            </p>
            <Button variant="secondary" onClick={() => void start()}>
              Play again
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
