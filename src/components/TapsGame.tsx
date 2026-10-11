import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card, CardHeader } from '../components/ui'

const WINDOW_MS = 5000

type Phase = { name: 'idle' } | { name: 'tapping'; left: number } | { name: 'done'; text: string; kind: 'ok' | 'err' }

// Tap frenzy: as many taps as you can in 5 seconds. 40+ pays 50 cr,
// 25+ pays 25 cr, 5+ pays 10 cr. 3 paid plays a day. Anything outside
// 5–60 taps scores nothing, so autoclickers gain nothing extra.
export default function TapsGame() {
  const [playsLeft, setPlaysLeft] = useState<number | null>(null)
  const [taps, setTaps] = useState(0)
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const timer = useRef<number | null>(null)
  const claimed = useRef(false)
  const tapsRef = useRef(0)

  const load = async () => {
    try {
      const s = await api.get<{ games: Record<string, { plays_left: number }> }>('/games/status')
      setPlaysLeft(s.games.taps.plays_left)
    } catch {
      // leave unknown
    }
  }

  useEffect(() => {
    void load()
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current)
    }
  }, [])

  async function start() {
    if (timer.current !== null) window.clearInterval(timer.current)
    claimed.current = false
    try {
      const data = await api.post<{ round_id: string }>('/games/taps/start')
      setTaps(0)
      tapsRef.current = 0
      const startedAt = Date.now()
      setPhase({ name: 'tapping', left: WINDOW_MS / 1000 })
      timer.current = window.setInterval(() => {
        const left = Math.max(0, Math.ceil((WINDOW_MS - (Date.now() - startedAt)) / 1000))
        if (left <= 0) {
          if (timer.current !== null) window.clearInterval(timer.current)
          timer.current = null
          void finish(data.round_id)
        } else {
          setPhase({ name: 'tapping', left })
        }
      }, 250)
    } catch (err) {
      setPhase({ name: 'done', kind: 'err', text: err instanceof ApiError ? err.message : 'Could not start a round.' })
    }
  }

  async function finish(id: string) {
    if (claimed.current) return
    claimed.current = true
    const count = tapsRef.current
    try {
      const data = await api.post<{ reward: number; balance: number }>('/games/taps/claim', {
        round_id: id,
        count,
      })
      setPhase({ name: 'done', kind: 'ok', text: `${count} taps — +${data.reward} cr. Balance ${data.balance.toLocaleString('en-US')} cr.` })
    } catch (err) {
      setPhase({ name: 'done', kind: 'err', text: err instanceof ApiError ? err.message : 'Claim failed.' })
    } finally {
      await load()
    }
  }

  return (
    <Card>
      <CardHeader
        title="Tap frenzy"
        action={
          <span className="num text-[12px] text-muted" role="status">
            {playsLeft === null ? '…' : `${playsLeft}/3 paid plays left today`}
          </span>
        }
      />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[13px] text-muted">
          Five seconds on the clock — 40+ taps pays 50 cr, 25+ pays 25 cr, 5+ pays 10 cr.
        </p>
        {phase.name === 'idle' && (
          <Button onClick={() => void start()} className="self-start">
            Start 5 seconds
          </Button>
        )}
        {phase.name === 'tapping' && (
          <>
            <p className="num text-[12px] text-muted" role="status" aria-live="polite">
              {phase.left}s left · {taps} taps
            </p>
            <button
              onClick={() => {
                tapsRef.current += 1
                setTaps(tapsRef.current)
              }}
              className="min-h-[120px] rounded-lg border border-accent/40 bg-accent/10 p-6 text-center text-2xl font-bold"
              aria-label={`Tap! ${taps} taps so far`}
            >
              TAP · {taps}
            </button>
          </>
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
