import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Card, Credits } from '../components/ui'

type Model = {
  slug: string
  label: string
  description: string | null
  capabilities: string[]
  context_window: number | null
  max_output_tokens: number
  flat_rate_credits: number
  routing: string
  status: 'live' | 'slow' | 'down' | 'unknown'
  provider_count: number
}

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
}

export default function Models() {
  const [models, setModels] = useState<Model[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<{ models: Model[] }>('/models')
      .then((data) => setModels(data.models))
      .catch(() => setError('Could not load the catalog.'))
  }, [])

  if (error) return <p className="py-12 text-center text-[13px] text-loss">{error}</p>
  if (models === null) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">The Pool</h1>
        <p className="mt-1 text-[13px] text-muted">
          Indie models funded by the community. Chat costs credits — 1:1 with tokens, billed from the
          provider's reported usage.
        </p>
      </div>

      {models.length === 0 && (
        <Card className="p-8 text-center text-[13px] text-muted">
          The Pool is being filled. An admin can add models from the admin panel.
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {models.map((model) => (
          <Card key={model.slug} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${statusDot[model.status]}`} />
              <h2 className="text-[15px] font-semibold">{model.label}</h2>
              <span className="ml-auto text-[12px] capitalize text-muted">{model.status}</span>
            </div>
            {model.description && <p className="text-[13px] text-muted">{model.description}</p>}
            <div className="flex flex-wrap gap-1">
              {model.capabilities.map((tag) => (
                <span key={tag} className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">
                  {tag}
                </span>
              ))}
            </div>
            <dl className="num mt-1 grid grid-cols-2 gap-y-1 text-[12px] text-muted">
              <dt>Flat rate</dt>
              <dd className="text-right text-content">
                <Credits value={model.flat_rate_credits} /> cr
              </dd>
              <dt>Configs</dt>
              <dd className="text-right text-content">{model.provider_count}</dd>
              <dt>Routing</dt>
              <dd className="text-right text-content">{model.routing.replace('_', ' ')}</dd>
              {model.context_window && (
                <>
                  <dt>Context</dt>
                  <dd className="text-right text-content">{(model.context_window / 1000).toFixed(0)}K</dd>
                </>
              )}
              <dt>Max out</dt>
              <dd className="text-right text-content">{model.max_output_tokens.toLocaleString('en-US')}</dd>
            </dl>
            <Link to={`/chat?model=${model.slug}`} className="mt-2 self-start">
              <button className="btn-primary">Chat now</button>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  )
}
