import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { Card, CardHeader, Credits } from '../components/ui'

type Usage = {
  totals: { credits_spent: number; messages: number; tokens_reported: number }
  balance: { global: number; scoped: number; total: number }
  per_model: {
    model: string
    messages: number
    credits: number
    tokens: number | null
    input_tokens: number | null
    output_tokens: number | null
    flat_rate_messages: number
  }[]
  daily: { day: string; credits: number; messages: number }[]
  burn: { avg_daily: number; days_remaining: number | null; window_days: number }
  recent: {
    model: string
    source: string
    status: string
    input_tokens: number | null
    output_tokens: number | null
    total_tokens: number | null
    credits_charged: number
    latency_ms: number | null
    created_at: number
  }[]
}

export default function Usage() {
  const { user, loading } = useAuth()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    api
      .get<Usage>('/usage')
      .then(setUsage)
      .catch(() => setError('Could not load usage.'))
  }, [user])

  if (loading) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>
  if (!user) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Usage</h1>
        <p className="mt-2 text-[13px] text-muted">Sign in to see your credit spend.</p>
        <Link to="/login" className="btn-primary mt-4 inline-block">Sign in</Link>
      </Card>
    )
  }
  if (error) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-[13px] text-loss" role="alert">{error}</p>
        <button onClick={() => { setError(''); setUsage(null); api.get<Usage>('/usage').then(setUsage).catch(() => setError('Could not load usage.')) }} className="btn-secondary mt-4">
          Retry
        </button>
      </div>
    )
  }
  if (!usage) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  const maxDaily = Math.max(1, ...usage.daily.map((d) => d.credits))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Usage</h1>
        <p className="mt-1 text-[13px] text-muted">
          Every request metered from provider-reported token counts — or the model's flat rate when
          usage is unreported. Failed requests are never charged; stopped streams bill the flat rate.
          Balance: <Credits value={usage.balance.total} /> cr.
        </p>
      </div>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-muted">Spent</p>
          <p className="num mt-1 text-xl font-semibold">
            <Credits value={usage.totals.credits_spent} />
          </p>
          <p className="text-[12px] text-muted">credits lifetime</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-muted">Messages</p>
          <p className="num mt-1 text-xl font-semibold">{usage.totals.messages.toLocaleString('en-US')}</p>
          <p className="text-[12px] text-muted">pool requests</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-muted">Tokens</p>
          <p className="num mt-1 text-xl font-semibold">
            <Credits value={usage.totals.tokens_reported} />
          </p>
          <p className="text-[12px] text-muted">reported by providers</p>
        </Card>
        <Card className="p-4">
          <p className="text-[12px] uppercase tracking-wide text-muted">Burn rate</p>
          <p className="num mt-1 text-xl font-semibold">
            <Credits value={usage.burn.avg_daily} />
            <span className="text-[13px] text-muted">/day</span>
          </p>
          <p className="text-[12px] text-muted">
            {usage.burn.days_remaining != null
              ? `~${usage.burn.days_remaining} days of balance left (last ${usage.burn.window_days} days)`
              : `last ${usage.burn.window_days} days`}
          </p>
        </Card>
      </div>

      {/* Daily bars */}
      {usage.daily.length > 0 && (
        <Card>
          <CardHeader title="Last 14 days" />
          <div className="flex items-end gap-1 p-4" role="img" aria-label={`Daily credit spend, max ${maxDaily.toLocaleString('en-US')} credits in a day`}>
            {usage.daily.map((day) => (
              <div key={day.day} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={`w-full rounded-t ${day.credits === 0 ? 'bg-line' : 'bg-accent/70'}`}
                  style={{ height: `${Math.max(2, (day.credits / maxDaily) * 80)}px` }}
                  title={`${day.day}: ${day.credits.toLocaleString('en-US')} cr · ${day.messages} msgs`}
                />
                <span className="num text-[10px] text-muted">{day.day.slice(5)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Per model */}
      {usage.per_model.length > 0 && (
        <Card>
          <CardHeader title="By model" />
          <div className="flex flex-col divide-y divide-line">
            {usage.per_model.map((row) => (
              <div key={row.model} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-[13px] font-medium">{row.model}</span>
                <span className="num text-[12px] text-muted">{row.messages} msgs</span>
                {row.tokens != null ? (
                  <span className="num text-[12px] text-muted">
                    <span className="sr-only">input </span>{row.input_tokens?.toLocaleString('en-US') ?? '—'}
                    <span aria-hidden="true"> in · </span><span className="sr-only">output </span>{row.output_tokens?.toLocaleString('en-US') ?? '—'} out
                  </span>
                ) : (
                  <span className="num text-[12px] text-muted">tokens unreported</span>
                )}
                {row.flat_rate_messages > 0 && (
                  <span className="text-[12px] text-muted" title="Requests billed at the model's flat rate because the provider reported no token usage">
                    {row.flat_rate_messages} flat-rate ({row.flat_rate_messages === row.messages ? 'all' : 'some'})
                  </span>
                )}
                <span className="num ml-auto text-[13px]">
                  <Credits value={row.credits} /> cr
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent requests */}
      <Card>
        <CardHeader title="Recent requests" />
        {usage.recent.length === 0 && <p className="p-4 text-[13px] text-muted">No pool requests yet.</p>}
        <div className="flex flex-col divide-y divide-line">
          {usage.recent.map((event, index) => (
            <div key={index} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="text-[13px]">{event.model}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] ${
                  event.status === 'completed'
                    ? 'bg-gain/10 text-gain'
                    : event.status === 'aborted'
                      ? 'bg-warn/10 text-warn'
                      : 'bg-loss/10 text-loss'
                }`}
              >
                {event.status}
              </span>
              {event.total_tokens != null ? (
                <span className="num text-[12px] text-muted">
                  <span className="sr-only">input </span>{event.input_tokens?.toLocaleString('en-US') ?? '—'}
                  <span aria-hidden="true">→</span><span className="sr-only"> output </span>{event.output_tokens?.toLocaleString('en-US') ?? '—'} tokens
                </span>
              ) : (
                <span className="text-[12px] text-muted">flat rate (usage unreported)</span>
              )}
              {event.latency_ms != null && <span className="num text-[12px] text-muted" title="Request latency">{event.latency_ms}ms</span>}
              <span className="num ml-auto text-[13px]" title={event.status}>
                {event.credits_charged > 0
                  ? `${event.credits_charged.toLocaleString('en-US')} cr`
                  : event.status === 'failed'
                    ? 'no charge (failed)'
                    : 'free'}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
