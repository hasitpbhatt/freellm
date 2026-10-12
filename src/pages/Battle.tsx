import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { streamBattle, type BattleStreamEvent } from '../lib/arena'
import { useAuth } from '../lib/auth'
import { Button, Card, CardHeader } from '../components/ui'

type ArenaModel = {
  slug: string
  label: string
  status: 'live' | 'slow' | 'down' | 'unknown'
  elo: number
  games: number
  wins: number
  win_rate: number | null
  configs: number
}

type LeaderRow = ArenaModel

type RecentBattle = {
  id: string
  prompt: string
  created_at: number
  votes: number
  columns: { label: string; slug: string; preview: string; error: boolean }[]
}

type Column = {
  label: string
  content: string
  streaming: boolean
  error: string | null
  cost: { credits: number; source: string; usage: { input: number; output: number; total: number } | null } | null
  revealedSlug: string | null
  elo: { delta: number; after: number } | null
}

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
}

export default function Battle() {
  const { user, loading, refresh } = useAuth()
  const [models, setModels] = useState<ArenaModel[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [columns, setColumns] = useState<Column[]>([])
  const [battleId, setBattleId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [voted, setVoted] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([])
  const [recent, setRecent] = useState<RecentBattle[]>([])

  const runBlockReason = !user
    ? 'Sign in to run battles.'
    : selected.length < 2
      ? 'Pick at least 2 models to compare.'
      : !prompt.trim()
        ? 'Write a prompt first.'
        : running
          ? 'Battle in progress…'
          : ''

  const loadArena = useCallback(async () => {
    try {
      const [arena, catalog] = await Promise.all([
        api.get<{ leaderboard: LeaderRow[]; recent_battles: RecentBattle[] }>('/arena'),
        api.get<{ models: { slug: string; label: string; status: string }[] }>('/models'),
      ])
      setLeaderboard(arena.leaderboard)
      setRecent(arena.recent_battles)
      const bySlug = new Map(catalog.models.map((m) => [m.slug, m]))
      const merged: ArenaModel[] = arena.leaderboard.map((row) => ({
        ...row,
        status: (bySlug.get(row.slug)?.status ?? 'unknown') as ArenaModel['status'],
      }))
      setModels(
        merged.length > 0
          ? merged
          : catalog.models.map((m) => ({
              slug: m.slug,
              label: m.label,
              status: m.status as ArenaModel['status'],
              elo: 1500,
              games: 0,
              wins: 0,
              win_rate: null,
              configs: 0,
            })),
      )
    } catch {
      setError('Could not load the arena.')
    }
  }, [])

  useEffect(() => {
    void loadArena()
  }, [loadArena])

  function toggleModel(slug: string) {
    setSelected((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug)
      if (prev.length >= 4) return prev
      return [...prev, slug]
    })
  }

  function reset() {
    setColumns([])
    setBattleId(null)
    setVoted(false)
    setError('')
  }

  async function run(event: FormEvent) {
    event.preventDefault()
    if (selected.length < 2 || !prompt.trim() || running) return
    setRunning(true)
    setError('')
    setVoted(false)
    setColumns([])

    let result: { ok: boolean; error?: string } = { ok: false }
    try {
      result = await streamBattle({ prompt: prompt.trim(), models: selected }, {
        onEvent: (event: BattleStreamEvent) => {
          switch (event.type) {
            case 'battle':
              setBattleId(event.id)
              setColumns([])
              break
            case 'start':
              setColumns((prev) => [
                ...prev,
                { label: event.label, content: '', streaming: true, error: null, cost: null, revealedSlug: null, elo: null },
              ])
              break
            case 'delta':
              setColumns((prev) =>
                prev.map((c) => (c.label === event.label ? { ...c, content: c.content + event.content } : c)),
              )
              break
            case 'settled':
              setColumns((prev) =>
                prev.map((c) =>
                  c.label === event.label
                    ? { ...c, streaming: false, cost: { credits: event.credits, source: event.source, usage: event.usage } }
                    : c,
                ),
              )
              break
            case 'error':
              setColumns((prev) =>
                prev.map((c) => (c.label === event.label ? { ...c, streaming: false, error: event.message } : c)),
              )
              break
            case 'done':
              setRunning(false)
              break
          }
        },
      })
    } finally {
      setRunning(false)
    }
    await Promise.all([refresh(), loadArena()])
    if (!result.ok && result.error) setError(result.error)
  }

  async function vote(label: string) {
    if (!battleId || voted) return
    try {
      const data = await api.post<{
        voted: string
        revealed: { label: string; slug: string; error: boolean }[]
        elo: { slug: string; delta: number; after: number }[]
      }>(`/battles/${battleId}/vote`, { label })
      setVoted(true)
      const eloBySlug = new Map(data.elo.map((e) => [e.slug, e]))
      setColumns((prev) =>
        prev.map((c) => {
          const revealed = data.revealed.find((r) => r.label === c.label)
          const elo = revealed ? eloBySlug.get(revealed.slug) : null
          return {
            ...c,
            revealedSlug: revealed?.slug ?? null,
            elo: elo ? { delta: elo.delta, after: elo.after } : null,
          }
        }),
      )
      await loadArena()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vote failed.')
    }
  }

  if (loading) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">The Arena</h1>
        <p className="mt-1 text-[13px] text-muted">
          One prompt, answered blind. Vote for the best answer — identities and Elo ratings reveal
          after you vote.
        </p>
      </div>

      {error && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-loss">
          <span className="flex-1">{error}</span>
          <button onClick={() => void loadArena()} className="text-accent hover:underline">
            Retry
          </button>
        </p>
      )}

      {/* Setup */}
      <Card>
        <CardHeader title="Start a battle" action={<span className="num text-[12px] text-muted">{selected.length}/4 picked · pick 2–4</span>} />
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Models to battle">
            {models.map((model) => {
              const active = selected.includes(model.slug)
              return (
                <button
                  key={model.slug}
                  onClick={() => toggleModel(model.slug)}
                  aria-pressed={active}
                  title={model.status === 'down' ? `${model.label} is down — battles with it will fail free` : model.label}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition-colors ${
                    active ? 'border-accent bg-accent/10' : 'border-line bg-surface-2 hover:border-muted'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${statusDot[model.status]}`} aria-hidden="true" />
                  {model.label}
                  {model.games > 0 ? (
                    <span className="num text-[11px] text-muted">{model.elo}</span>
                  ) : (
                    <span className="num text-[11px] text-muted">unranked</span>
                  )}
                </button>
              )
            })}
            {models.length === 0 && <p className="text-[13px] text-muted">No models in The Pool yet.</p>}
          </div>

          <form className="flex flex-col gap-3" onSubmit={run}>
            <label className="text-[12px] font-medium uppercase tracking-wide text-muted" htmlFor="battle-prompt">
              Prompt for all models
            </label>
            <textarea
              id="battle-prompt"
              className="input min-h-[80px] resize-y"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Write a Python function that reverses a linked list, with tests."
              maxLength={4000}
            />
            <p className="num text-[12px] text-muted">{prompt.length}/4000</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={selected.length < 2 || !prompt.trim() || running || !user} title={runBlockReason}>
                {running ? 'Battling…' : 'Run battle'}
              </Button>
              {!user && (
                <span className="text-[13px] text-muted">
                  <Link to="/login" className="text-accent hover:underline">Sign in</Link> to run battles.
                </span>
              )}
              {user && (selected.length < 2 || !prompt.trim()) && !running && (
                <span className="text-[13px] text-muted">
                  {selected.length < 2 ? 'Pick at least 2 models above.' : 'Write a prompt to compare.'}
                </span>
              )}
              {columns.length > 0 && !running && (
                <Button variant="ghost" onClick={reset}>Clear results</Button>
              )}
            </div>
          </form>
        </div>
      </Card>

      {/* Blind columns */}
      {columns.length > 0 && (
        <div className={`grid gap-4 ${columns.length > 2 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-2'}`}>
          {columns.map((column) => (
            <Card key={column.label} className="flex flex-col">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-[13px] font-semibold">
                  {column.label}
                </span>
                {column.streaming && <span className="text-[12px] text-muted">streaming…</span>}
                {column.revealedSlug && (
                  <span className="text-[13px] font-medium">{column.revealedSlug}</span>
                )}
                {column.elo && (
                  <span className={`num ml-auto text-[12px] ${column.elo.delta >= 0 ? 'text-gain' : 'text-loss'}`}>
                    {column.elo.delta >= 0 ? '+' : ''}
                    {column.elo.delta} → {column.elo.after}
                  </span>
                )}
              </div>
              <div className="flex-1 whitespace-pre-wrap p-4 text-[13px]">
                {column.content || (column.streaming ? <span className="text-muted">thinking…</span> : null)}
                {column.error && <span className="text-loss">{column.error}</span>}
              </div>
              <div className="border-t border-line px-4 py-2.5">
                {column.cost ? (
                  <p className="num text-[12px] text-muted">
                    {column.cost.credits.toLocaleString('en-US')} cr
                    {column.cost.usage
                      ? ` — ${column.cost.usage.input.toLocaleString('en-US')} in · ${column.cost.usage.output.toLocaleString('en-US')} out`
                      : ' — flat rate'}
                  </p>
                ) : column.streaming ? null : (
                  <p className="text-[12px] text-muted">no charge</p>
                )}
                {!voted && !column.streaming && column.content && !column.error && (
                  <Button
                    variant="secondary"
                    className="mt-2 w-full"
                    onClick={() => {
                      if (!confirm(`Vote for answer ${column.label} as the best? Votes are final and reveal all model identities.`)) return
                      void vote(column.label)
                    }}
                  >
                    Vote {column.label} best
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {voted && (
        <p className="text-[13px] text-gain">Vote counted — identities and Elo revealed above. Leaderboard updated.</p>
      )}

      {/* Leaderboard */}
      <Card>
        <CardHeader title="Leaderboard" action={<span className="num text-[12px] text-muted">Elo · {leaderboard.filter((m) => m.games > 0).length} ranked</span>} />
        <p className="px-4 pt-2 text-[12px] text-muted">
          Elo rates blind-vote wins. New models start at 1500 unranked; votes move ratings up or down.
        </p>
        <div className="flex flex-col divide-y divide-line">
          {leaderboard.map((row, index) => (
            <div key={row.slug} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="num w-6 text-right text-[13px] text-muted">{index + 1}</span>
              <span className={`h-2 w-2 rounded-full ${statusDot[row.status]}`} />
              <span className="text-[13px] font-medium">{row.label}</span>
              <code className="num text-[11px] text-muted">{row.slug}</code>
              <span className="num ml-auto text-[13px]">{row.elo}</span>
              <span className="num w-20 text-right text-[12px] text-muted">
                {row.games} {row.games === 1 ? 'battle' : 'battles'}
              </span>
              <span className="num w-14 text-right text-[12px] text-muted">
                {row.win_rate != null ? `${row.win_rate}% W` : '—'}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Recent battles — public replays */}
      <Card>
        <CardHeader title="Recent battles" action={<span className="text-[12px] text-muted">revealed replays</span>} />
        {recent.length === 0 && <p className="p-4 text-[13px] text-muted">No battles yet — run the first one.</p>}
        <div className="flex flex-col divide-y divide-line">
          {recent.map((battle) => (
            <div key={battle.id} className="flex flex-col gap-2 px-4 py-3">
              <p className="text-[13px] text-muted">"{battle.prompt}"</p>
              <div className="flex flex-wrap gap-2">
                {battle.columns.map((column) => (
                  <span key={column.label} className="rounded bg-surface-2 px-2 py-1 text-[11px]">
                    <span className="num text-muted">{column.label}</span> {column.slug}
                  </span>
                ))}
              </div>
              <p className="num text-[11px] text-muted" title={new Date(battle.created_at).toLocaleString()}>
                {battle.votes} {battle.votes === 1 ? 'vote' : 'votes'} · {relativeTime(battle.created_at)}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
