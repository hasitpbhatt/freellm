import { Link } from 'react-router-dom'
import { Button, Card } from '../components/ui'
import { useEffect, useState } from 'react'
import { api, normalizeCatalogModel, type CatalogModel } from '../lib/api'
import { useAuth } from '../lib/auth'

const doors = [
  {
    key: 'byok',
    icon: '🔑',
    title: 'Your Key',
    tagline: 'Free forever',
    body: 'Bring your own API key and chat with indie models — unlimited, never spends credits. Your key is encrypted and yours alone.',
    cta: { label: 'Add your key', to: '/keys' },
  },
  {
    key: 'pool',
    icon: '◇',
    title: 'The Pool',
    tagline: 'Funded by the community',
    body: 'Models shared by contributors. Credits spend 1:1 on tokens here — earn them by checking in daily, inviting friends, and contributing keys.',
    cta: { label: 'Browse models', to: '/models' },
  },
]

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
}

type Replay = {
  id: string
  prompt: string
  created_at: number
  votes: number
  columns: { label: string; slug: string; preview: string; error: boolean }[]
}

export default function Landing() {
  const { user, loading } = useAuth()
  const [replays, setReplays] = useState<Replay[]>([])
  const [replaysFailed, setReplaysFailed] = useState(false)
  const [pool, setPool] = useState<CatalogModel[] | null>(null)

  // Public battle replays — the no-account surface
  useEffect(() => {
    api
      .get<{ recent_battles: Replay[] }>('/arena')
      .then((data) => setReplays(data.recent_battles.slice(0, 3)))
      .catch(() => {
        setReplays([])
        setReplaysFailed(true)
      })
  }, [])
  useEffect(() => {
    api
      .get<{ models: unknown }>('/models')
      .then((data) =>
        setPool(Array.isArray(data?.models) ? data.models.map(normalizeCatalogModel) : []),
      )
      .catch(() => setPool([]))
  }, [])
  return (
    <div className="flex flex-col gap-16 py-10">
      {/* Hero — the Two Doors model, taught in three lines */}
      <section className="flex flex-col items-center gap-6 text-center">
        <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
          The community-owned arena for{' '}
          <span className="text-accent">indie AI models</span>
        </h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-muted">
          Two ways in. Bring your own key and chat free forever — or spend credits on The Pool,
          the models our contributors keep alive. No upfront tokens. Earn what you spend.
        </p>
        <div className="flex min-h-[52px] flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          {loading ? (
            <span className="text-[13px] text-muted" role="status">Checking sign-in…</span>
          ) : user ? (
            <>
              <Link to="/chat">
                <Button>Start chatting</Button>
              </Link>
              <Link to="/dashboard">
                <Button variant="secondary">Open dashboard</Button>
              </Link>
            </>
          ) : (
            <>
              <Link to="/login">
                <Button>Sign in with Google</Button>
              </Link>
              <Link to="/battle">
                <Button variant="secondary">Open the arena — no account needed</Button>
              </Link>
            </>
          )}
        </div>
        <Link to="/developers" className="text-[13px] text-muted hover:text-content">
          …or use it from your code →
        </Link>
      </section>

      {/* The two doors */}
      <section className="grid gap-4 md:grid-cols-2">
        {doors.map((door) => (
          <Card key={door.key} className="flex flex-col gap-3 p-6">
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">{door.icon}</span>
              <div>
                <h2 className="text-lg font-semibold">{door.title}</h2>
                <p className="text-[13px] text-muted">{door.tagline}</p>
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-muted">{door.body}</p>
            <Link to={door.cta.to} className="mt-auto self-start">
              <Button variant="secondary">{door.cta.label}</Button>
            </Link>
          </Card>
        ))}
      </section>

      {/* Public battle replays */}
      {replays.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            Recent arena battles — pick a winner, no account needed
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {replays.map((replay) => (
              <Link key={replay.id} to="/battle" className="block">
                <Card className="flex h-full flex-col gap-2 p-4 transition-colors hover:border-muted">
                  <p className="line-clamp-2 text-[13px] font-medium">"{replay.prompt}"</p>
                  <div className="flex flex-wrap gap-1.5">
                    {replay.columns.map((column) => (
                      <span key={column.label} className="num rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                        {column.slug}
                      </span>
                    ))}
                  </div>
                  <p className="num text-[11px] text-muted">{replay.votes} votes · tap to vote</p>
                </Card>
              </Link>
            ))}
          </div>
          <Link to="/battle" className="self-start">
            <Button variant="secondary">Open the arena →</Button>
          </Link>
        </section>
      ) : replaysFailed ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            Recent arena battles
          </h2>
          <Card className="p-4 text-[13px] text-muted">
            Couldn't load recent battles. <Link to="/battle" className="text-accent hover:underline">Open the arena anyway →</Link>
          </Card>
        </section>
      ) : null}

      {/* Live pool status */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          The Pool — live status
        </h2>
        {pool === null ? (
          <Card className="px-4 py-3 text-[13px] text-muted" role="status">Checking pool status…</Card>
        ) : pool.length === 0 ? (
          <Card className="px-4 py-3 text-[13px] text-muted">The Pool is being filled — check back soon.</Card>
        ) : (
          <Card className="divide-y divide-line">
            {pool.map((m) => (
              <div key={m.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot[m.status]}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{m.label}</span>
                <span className="shrink-0 text-[13px] capitalize text-muted">{m.status}</span>
                {m.access_tier !== 'free' && (
                  <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
                    🔒 {m.access_tier}
                  </span>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  )
}
