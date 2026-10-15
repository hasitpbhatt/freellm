import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card, CardHeader } from '../components/ui'
import { useAuth } from '../lib/useAuth'

type Phase = { name: 'idle' } | { name: 'typing'; roundId: string } | { name: 'done'; text: string; kind: 'ok' | 'err' }

type TypingTier = { min_wpm: number; reward: number }

// Fallback matches the server TYPING_TIERS — replaced by /games/status on load.
const FALLBACK_TIERS: TypingTier[] = [
  { min_wpm: 80, reward: 10000 },
  { min_wpm: 50, reward: 5000 },
  { min_wpm: 0, reward: 2500 },
]

// Typing sprint: the server deals a phrase — retype it exactly, fast.
// The claim only pays on an exact server-side match, so pasting foreign
// text or gibberish scores nothing. 3 paid plays a day.
export default function TypingGame() {
  const [playsLeft, setPlaysLeft] = useState<number | null>(null)
  const [tiers, setTiers] = useState<TypingTier[]>(FALLBACK_TIERS)
  const [phrase, setPhrase] = useState<string | null>(null)
  const [roundId, setRoundId] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const claimed = useRef(false)
  const { refresh } = useAuth()

  const load = async () => {
    try {
      const s = await api.get<{ games: Record<string, { plays_left: number }>; typing_tiers?: TypingTier[] }>('/games/status')
      setPlaysLeft(s.games.typing.plays_left)
      if (Array.isArray(s.typing_tiers) && s.typing_tiers.length > 0) setTiers(s.typing_tiers)
    } catch {
      // leave unknown
    }
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- typing-game status load on mount
    void load()
  }, [])

  async function start() {
    setTyped('')
    claimed.current = false
    try {
      const data = await api.post<{ round_id: string; phrase: string }>('/games/typing/start')
      setRoundId(data.round_id)
      setPhrase(data.phrase)
      setPhase({ name: 'typing', roundId: data.round_id })
    } catch (err) {
      setPhase({ name: 'done', kind: 'err', text: err instanceof ApiError ? err.message : 'Could not start a round.' })
    }
  }

  async function claim(id: string, text: string) {
    if (claimed.current) return
    claimed.current = true
    try {
      const data = await api.post<{ reward: number; balance: number }>('/games/typing/claim', {
        round_id: id,
        typed: text,
      })
      setPhase({ name: 'done', kind: 'ok', text: `Perfect — +${data.reward} cr. Balance ${data.balance.toLocaleString('en-US')} cr.` })
      await refresh()
    } catch (err) {
      setPhase({ name: 'done', kind: 'err', text: err instanceof ApiError ? err.message : 'Claim failed.' })
    } finally {
      setPhrase(null)
      setRoundId(null)
      await load()
    }
  }

  const onType = (value: string) => {
    setTyped(value)
    if (phrase !== null && roundId !== null && value === phrase) {
      void claim(roundId, value)
    }
  }

  const wrongAt = phrase !== null && typed !== '' && !phrase.startsWith(typed) ? typed.length : -1

  return (
    <Card>
      <CardHeader
        title="Typing sprint"
        action={
          <span className="num text-[12px] text-muted" role="status">
            {playsLeft === null ? '…' : `${playsLeft}/3 paid plays left today`}
          </span>
        }
      />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[13px] text-muted">
          Retype the dealt phrase exactly — {tiers.map((t) => `${t.min_wpm}+ wpm pays ${t.reward.toLocaleString('en-US')} cr`).join(', ')}.
        </p>
        {phase.name === 'idle' && (
          <Button onClick={() => void start()} className="w-full sm:w-auto sm:self-start">
            Deal a phrase
          </Button>
        )}
        {phase.name === 'typing' && phrase !== null && (
          <>
            <p className="break-words rounded-lg border border-line bg-surface-2 p-3 font-mono text-[13px]" aria-label="Phrase to type">
              {phrase}
            </p>
            <label className="sr-only" htmlFor="typing-input">Retype the phrase exactly</label>
            <textarea
              id="typing-input"
              className="input min-h-[80px] font-mono text-[16px] sm:text-[13px]"
              value={typed}
              onChange={(e) => onType(e.target.value)}
              placeholder="Type it here…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="num text-[12px] text-muted" role="status">
              {typed.length}/{phrase.length} chars
              {wrongAt >= 0 ? ` — first mistake at char ${wrongAt + 1}, fix it to finish` : typed ? ' — matching so far' : ''}
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
