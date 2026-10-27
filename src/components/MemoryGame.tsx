import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card, CardHeader } from '../components/ui'
import { useAuth } from '../lib/useAuth'

type Phase =
  | { name: 'idle' }
  | { name: 'playing'; roundId: string }
  | { name: 'done'; text: string; kind: 'ok' | 'err' }

const PAIRS = 6
const CARDS = PAIRS * 2
const MAX_MOVES = 30
/** Face-down back, identical for every card so the board leaks nothing. */
const CARD_BACK = '✦'

// Memory match: 6 pairs, server-dealt. The board layout never reaches the
// client — each flip asks the server for that one card's face, so peeking
// the response payload tells you nothing about the rest of the board.
// Reward keyed off pair-attempts: <=8 pays 12k, <=12 pays 8k, a clear pays 4k.
export default function MemoryGame() {
  const [playsLeft, setPlaysLeft] = useState<number | null>(null)
  const [roundId, setRoundId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [faces, setFaces] = useState<(string | null)[]>(Array<string | null>(CARDS).fill(null))
  const [flipped, setFlipped] = useState<number[]>([])
  const [matched, setMatched] = useState<number[]>([])
  const [moves, setMoves] = useState(0)
  const [thinking, setThinking] = useState(false)
  const busy = useRef(false)
  const { refresh } = useAuth()

  const load = useCallback(async () => {
    try {
      const s = await api.get<{ games: Record<string, { plays_left: number }> }>('/games/status')
      setPlaysLeft(s.games.memory.plays_left)
    } catch {
      // leave unknown
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- memory-game status load on mount
    void load()
  }, [load])

  async function start() {
    busy.current = false
    setFaces(Array<string | null>(CARDS).fill(null))
    setFlipped([])
    setMatched([])
    setMoves(0)
    setThinking(false)
    try {
      const data = await api.post<{ round_id: string; pairs: number }>('/games/memory/start')
      setRoundId(data.round_id)
      setPhase({ name: 'playing', roundId: data.round_id })
    } catch (err) {
      setPhase({ name: 'done', kind: 'err', text: err instanceof ApiError ? err.message : 'Could not deal a board.' })
    }
  }

  async function flip(index: number): Promise<string | null> {
    if (!roundId) return null
    try {
      const data = await api.post<{ glyph: string }>('/games/memory/flip', { round_id: roundId, index })
      setFaces((prev) => prev.map((f, i) => (i === index ? data.glyph : f)))
      return data.glyph
    } catch (err) {
      setPhase({ name: 'done', kind: 'err', text: err instanceof ApiError ? err.message : 'Flip failed.' })
      return null
    }
  }

  const onCard = async (index: number) => {
    if (!roundId || thinking || matched.includes(index) || flipped.includes(index)) return

    if (flipped.length === 0) {
      // First flip: reveal this card alone.
      setThinking(true)
      setFlipped([index])
      await flip(index)
      setThinking(false)
      return
    }

    // Second flip: reveal, then compare against the first.
    const first = flipped[0]
    setThinking(true)
    const glyph = await flip(index)
    const firstGlyph = faces[first]
    const nextMoves = moves + 1

    if (glyph != null && firstGlyph != null && glyph === firstGlyph) {
      // Pair landed.
      setMatched((m) => [...m, first, index])
      setFlipped([])
      setMoves(nextMoves)
      if (matched.length + 2 === CARDS && nextMoves <= MAX_MOVES) {
        // Final pair — claim after a beat so the player sees the board.
        setThinking(false)
        setTimeout(() => void claimWithMoves(nextMoves), 400)
        return
      }
    } else {
      // Miss: count the attempt, hide both after a beat so the player sees the mismatch.
      setMoves(nextMoves)
      if (nextMoves >= MAX_MOVES) {
        setThinking(false)
        setPhase({ name: 'done', kind: 'err', text: `Attempt limit reached at ${nextMoves} pair-attempts — deal a fresh board to try again.` })
        setRoundId(null)
        return
      }
      // Keep both cards visible briefly so the mismatch is visible, then hide.
      setTimeout(() => {
        setFlipped([])
        setFaces((f) => f.map((v, i) => (i === first || i === index ? null : v)))
      }, 800)
    }
    setThinking(false)
  }

  const claimWithMoves = async (finalMoves: number) => {
    if (!roundId || busy.current) return
    busy.current = true
    try {
      const data = await api.post<{ reward: number; balance: number }>('/games/memory/claim', {
        round_id: roundId,
      })
      setPhase({
        name: 'done',
        kind: 'ok',
        text: `Board cleared in ${finalMoves} moves — +${data.reward.toLocaleString('en-US')} cr. Balance ${data.balance.toLocaleString('en-US')} cr.`,
      })
      await refresh()
    } catch (err) {
      setPhase({ name: 'done', kind: 'err', text: err instanceof ApiError ? err.message : 'Claim failed.' })
    } finally {
      setRoundId(null)
      await load()
    }
  }

  return (
    <Card>
      <CardHeader
        title="Memory match"
        action={
          <span className="num text-[12px] text-muted" role="status">
            {playsLeft === null ? '…' : `${playsLeft}/2 paid plays left today`}
          </span>
        }
      />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[13px] text-muted">
          Six pairs, dealt fresh. Fewest pair-attempts pays best: 8 or fewer pays 12,000 cr, 12 or fewer
          pays 8,000 cr, any clear pays 4,000 cr. A perfect board is 6.
        </p>
        {phase.name === 'idle' && (
          <Button onClick={() => void start()} className="w-full sm:w-auto sm:self-start">
            Deal a board
          </Button>
        )}
        {phase.name === 'playing' && (
          <>
            <div className="grid grid-cols-4 gap-2" role="group" aria-label="Memory board">
              {Array.from({ length: CARDS }, (_, i) => i).map((i) => {
                const shown = matched.includes(i) || flipped.includes(i) ? faces[i] ?? CARD_BACK : CARD_BACK
                return (
                  <button
                    key={i}
                    onClick={() => onCard(i)}
                    disabled={thinking || matched.includes(i)}
                    aria-label={matched.includes(i) || flipped.includes(i) ? `Card ${i + 1}: revealed` : `Card ${i + 1}: hidden`}
                    className={`num flex aspect-square items-center justify-center rounded-lg border text-[22px] transition-colors sm:text-[26px] ${
                      matched.includes(i)
                        ? 'border-gain/40 bg-gain/10 text-content'
                        : flipped.includes(i)
                          ? 'border-accent bg-accent/10 text-content'
                          : 'border-line bg-surface-2 text-muted hover:border-accent/50'
                    } ${thinking || matched.includes(i) ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    {shown}
                  </button>
                )
              })}
            </div>
            <p className="num text-[12px] text-muted" role="status">
              pair-attempts {moves} · {matched.length}/{CARDS} cards matched
              {moves >= MAX_MOVES ? ' — attempt limit reached, start a fresh board' : ''}
            </p>
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
