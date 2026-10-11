import { Link } from 'react-router-dom'
import { Button, Card } from '../components/ui'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
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

// M3: replace with live data from GET /api/models
const poolStatus = [
  { model: 'Poolside Laguna', provider: 'poolside', status: 'live' },
  { model: 'Agnes', provider: 'agnes', status: 'live' },
  { model: 'Atria', provider: 'atria', status: 'slow' },
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

  // Public battle replays — the no-account surface
  useEffect(() => {
    api
      .get<{ recent_battles: Replay[] }>('/arena')
      .then((data) => setReplays(data.recent_battles.slice(0, 3)))
      .catch(() => setReplays([]))
  }, [])
  return (
    <div className="flex flex-col gap-16 py-10">
      {/* Hero — the Two Doors model, taught in three lines */}
      <section className="flex flex-col items-center gap-6 text-center">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight md:text-5xl">
          The community-owned arena for{' '}
          <span className="text-accent">indie AI models</span>
        </h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-muted">
          Two ways in. Bring your own key and chat free forever — or spend credits on The Pool,
          the models our contributors keep alive. No upfront tokens. Earn what you spend.
        </p>
        <div className="flex gap-3">
          {loading ? null : user ? (
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
              <Link to="/register">
                <Button>Create account</Button>
              </Link>
              <Link to="/battle">
                <Button variant="secondary">Watch a battle — no account</Button>
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
              <span className="text-2xl">{door.icon}</span>
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
      {replays.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            Recent arena battles — watch free, no account
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {replays.map((replay) => (
              <Card key={replay.id} className="flex flex-col gap-2 p-4">
                <p className="line-clamp-2 text-[13px] font-medium">"{replay.prompt}"</p>
                <div className="flex flex-wrap gap-1.5">
                  {replay.columns.map((column) => (
                    <span key={column.label} className="num rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                      {column.slug}
                    </span>
                  ))}
                </div>
                <p className="num text-[11px] text-muted">{replay.votes} votes</p>
              </Card>
            ))}
          </div>
          <Link to="/battle" className="self-start">
            <Button variant="secondary">Open the arena →</Button>
          </Link>
        </section>
      )}

      {/* Live pool status */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          The Pool — live status
        </h2>
        <Card className="divide-y divide-line">
          {poolStatus.map((m) => (
            <div key={m.model} className="flex items-center gap-3 px-4 py-3">
              <span className={`h-2 w-2 rounded-full ${statusDot[m.status]}`} />
              <span className="text-[13px] font-medium">{m.model}</span>
              <span className="text-[13px] capitalize text-muted">{m.status}</span>
            </div>
          ))}
        </Card>
      </section>
    </div>
  )
}
