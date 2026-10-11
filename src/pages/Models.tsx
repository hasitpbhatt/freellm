import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, normalizeCatalogModel, type CatalogModel } from '../lib/api'
import { Card, Credits } from '../components/ui'

type Model = CatalogModel

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
}

import { useAuth } from '../lib/auth'

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, enterprise: 2 }

export default function Models() {
  const { user } = useAuth()
  const [models, setModels] = useState<Model[] | null>(null)
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    setModels(null)
    api
      .get<{ models: unknown }>('/models')
      .then((data) =>
        setModels(Array.isArray(data?.models) ? data.models.map(normalizeCatalogModel) : []),
      )
      .catch(() => setError('Could not load the catalog.'))
  }

  useEffect(() => {
    load()
  }, [])

  const isLocked = (model: Model) =>
    model.access_tier !== 'free' &&
    user?.role !== 'admin' &&
    (TIER_RANK[user?.tier ?? 'free'] ?? 0) < (TIER_RANK[model.access_tier] ?? 0)

  if (error) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-[13px] text-loss" role="alert">{error}</p>
        <button onClick={load} className="btn-secondary mt-4">
          Retry
        </button>
      </div>
    )
  }
  if (models === null) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">The Pool</h1>
        <p className="mt-1 text-[13px] text-muted">
          Community-funded models. Chat costs credits — 1 credit = 1 token, billed from the
          provider's reported usage (flat rate only when usage is unreported). 🔒 badges need a
          higher tier; scoped-only models spend their own promo credits, never global balance.
        </p>
      </div>

      {models.length === 0 && (
        <Card className="p-8 text-center text-[13px] text-muted">
          The Pool is being filled — check back soon.
          {user?.role === 'admin' && (
            <> As an admin you can add models from the admin panel.</>
          )}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {models.map((model) => (
          <Card key={model.slug} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${statusDot[model.status]}`} aria-hidden="true" />
              <h2 className="text-[15px] font-semibold">{model.label}</h2>
              {model.access_tier !== 'free' && (
                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent" title={`Requires ${model.access_tier} tier`}>
                  <span aria-hidden="true">🔒</span> {model.access_tier}
                  <span className="sr-only">(requires {model.access_tier} tier)</span>
                </span>
              )}
              {model.scoped_only === 1 && (
                <span className="rounded bg-warn/10 px-1.5 py-0.5 text-[11px] font-medium text-warn" title="Spends this model's scoped promo credits only — global balance cannot buy in">
                  scoped only
                </span>
              )}
              <span className="ml-auto text-[12px] capitalize text-muted">{model.status}</span>
            </div>
            {model.description && <p className="text-[13px] text-muted">{model.description}</p>}
            <div className="flex flex-wrap gap-1">
              {model.capabilities.map((tag) => (
                <span key={tag} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                  {tag}
                </span>
              ))}
            </div>
            <dl className="num mt-1 grid grid-cols-2 gap-y-1 text-[12px] text-muted">
              <dt>Flat rate (credits per request when usage unreported)</dt>
              <dd className="text-right text-content">
                <Credits value={model.flat_rate_credits} /> cr
              </dd>
              <dt>Provider configs</dt>
              <dd className="text-right text-content">{model.provider_count}</dd>
              <dt>Routing</dt>
              <dd className="text-right text-content" title="How requests spread across provider configs">{model.routing.replaceAll('_', ' ')}</dd>
              {model.context_window && (
                <>
                  <dt>Context window (tokens)</dt>
                  <dd className="text-right text-content">{model.context_window.toLocaleString('en-US')}</dd>
                </>
              )}
              <dt>Max output (tokens)</dt>
              <dd className="text-right text-content">{model.max_output_tokens.toLocaleString('en-US')}</dd>
            </dl>
            {isLocked(model) ? (
              <p className="mt-2 text-[12px] text-muted">
                Requires {model.access_tier} tier — ask an admin to upgrade.
              </p>
            ) : (
              <Link to={`/chat?model=${model.slug}`} className="btn-primary mt-2 self-start">
                Chat now
              </Link>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
