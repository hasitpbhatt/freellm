import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, normalizeCatalogModel, type CatalogModel } from '../lib/api'
import { Card, LoadingState, EmptyState } from '../components/ui'

type Model = CatalogModel

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
}

import { useAuth } from '../lib/useAuth'

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, enterprise: 2 }

export default function Models() {
  const { user } = useAuth()
  const [models, setModels] = useState<Model[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'status' | 'label' | 'context'>('status')

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
    // oxlint-disable-next-line react/set-state-in-effect -- pool catalog load on mount
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
  if (models === null) return <LoadingState />

  const statusRank: Record<string, number> = { live: 0, slow: 1, unknown: 2, down: 3 }
  const q = search.trim().toLowerCase()
  const visibleModels = models
    .filter((m) => (q === '' ? true : m.label.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort === 'status') return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || a.label.localeCompare(b.label)
      if (sort === 'label') return a.label.localeCompare(b.label)
      return (b.context_window ?? 0) - (a.context_window ?? 0)
    })

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
        <EmptyState title="The Pool is being filled — check back soon.">
          {user?.role === 'admin' && <>As an admin you can add models from the admin panel.</>}
        </EmptyState>
      )}

      <div className="flex flex-wrap gap-2">
        <input className="input min-w-[180px] flex-1" placeholder="Search models..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as any)}>
          <option value="status">Sort: status</option>
          <option value="label">Sort: name</option>
          <option value="context">Sort: context</option>
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleModels.map((model) => (
          <Card key={model.slug} className="flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot[model.status]}`} aria-hidden="true" />
              <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={model.label}>{model.label}</h2>
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
            <dl className="num mt-1 grid grid-cols-1 gap-y-1 text-[12px] text-muted min-[380px]:grid-cols-2">
              <dt>Billing</dt>
              <dd className="text-left text-content min-[380px]:text-right">
                Usage-based · 1 cr = 1 token
              </dd>
              <dt>Provider configs</dt>
              <dd className="text-left text-content min-[380px]:text-right">{model.provider_count}</dd>
              <dt>Routing</dt>
              <dd className="text-left text-content min-[380px]:text-right" title="How requests spread across provider configs">{model.routing.replaceAll('_', ' ')}</dd>
              {model.context_window && (
                <>
                  <dt>Context window (tokens)</dt>
                  <dd className="text-left text-content min-[380px]:text-right">{model.context_window.toLocaleString('en-US')}</dd>
                </>
              )}
              <dt>Max output (tokens)</dt>
              <dd className="text-left text-content min-[380px]:text-right">{model.max_output_tokens.toLocaleString('en-US')}</dd>
            </dl>
            <p className="num min-w-0 truncate text-[12px] text-muted" title={`Slug: ${model.slug}`}>
              slug: <span className="text-accent">{model.slug}</span>
            </p>
            {isLocked(model) ? (
              <p className="mt-2 text-[12px] text-muted">
                Requires {model.access_tier} tier — upgrade not available yet.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                <Link to={`/chat?model=${model.slug}`} className="btn-primary self-start">
                  Chat now
                </Link>
                <button
                  className="btn-secondary btn-sm"
                  aria-label={`Copy slug ${model.slug}`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(model.slug)
                    } catch {
                      // long-press fallback: slug is selectable text above
                    }
                  }}
                >
                  Copy slug
                </button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
