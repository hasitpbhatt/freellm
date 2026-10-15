import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'
import type { ModelAlias } from '../lib/types'

type Promo = {
  id: string
  code: string
  description: string | null
  credits: number
  model_id: string | null
  model_slug: string | null
  model_label: string | null
  max_redemptions: number | null
  redemption_count: number
  per_user_limit: number
  min_account_age_hours: number
  starts_at: number | null
  expires_at: number | null
  active: number
  created_at: number
}

type Redemption = {
  credits: number
  created_at: number
  username: string
  email: string
  model_label: string | null
}

export default function AdminPromos() {
  const [promos, setPromos] = useState<Promo[] | null>(null)
  const [models, setModels] = useState<ModelAlias[]>([])
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [promoData, modelData] = await Promise.all([
        api.get<{ promos: Promo[] }>('/admin/promos'),
        api.get<{ models: ModelAlias[] }>('/admin/models'),
      ])
      setPromos(promoData.promos)
      setModels(modelData.models)
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?next=/admin'
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load promo codes.')
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- promo list load on mount
    void load()
  }, [load])

  if (error) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-[13px] text-loss" role="alert">{error}</p>
        <Button onClick={() => void load()} className="mt-4">
          Retry
        </Button>
      </div>
    )
  }
  if (promos === null) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Promo codes</h1>
        <p className="mt-1 text-[13px] text-muted">
          Codes grant tokens on redemption — globally, or scoped to one alias. Limits, expiry, and a
          minimum account age keep them from being farmed.
        </p>
      </div>

      <NewPromoForm models={models} onCreated={load} />

      {promos.length === 0 && (
        <Card className="p-8 text-center text-[13px] text-muted">No promo codes yet.</Card>
      )}

      {promos.map((promo) => (
        <Card key={promo.id}>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className={`h-2 w-2 rounded-full ${promo.active ? 'bg-gain' : 'bg-muted'}`} aria-hidden="true" />
            <span className="sr-only">{promo.active ? 'Active' : 'Inactive'}: </span>
            <code className="num rounded bg-surface-2 px-2 py-1 text-[13px] font-semibold">{promo.code}</code>
            <button
              onClick={() => { void navigator.clipboard.writeText(promo.code).catch(() => {}) }}
              className="text-[11px] text-muted hover:text-content"
              aria-label={`Copy promo code ${promo.code}`}
              title="Copy code"
            >
              Copy
            </button>
            <span className="num text-[13px]">+{promo.credits.toLocaleString('en-US')} cr</span>
            {promo.model_label ? (
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">{promo.model_label} only</span>
            ) : (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">any model</span>
            )}
            <span className="num text-[12px] text-muted" title="Redeemed / max · per-user limit">
              {promo.redemption_count}
              {promo.max_redemptions != null ? `/${promo.max_redemptions}` : ' (unlimited)'} redeemed · {promo.per_user_limit}/user
            </span>
            {promo.min_account_age_hours > 0 && (
              <span className="num text-[12px] text-muted">accounts older than {promo.min_account_age_hours}h only</span>
            )}
            {promo.expires_at ? (
              <span className="num text-[12px] text-muted" title={new Date(promo.expires_at).toLocaleString()}>
                {promo.starts_at ? `${new Date(promo.starts_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} → ` : ''}expires {new Date(promo.expires_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              </span>
            ) : (
              <span className="num text-[12px] text-muted">never expires</span>
            )}
            <div className="ml-auto flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setExpanded(expanded === promo.id ? null : promo.id)}
              >
                {expanded === promo.id ? 'Hide' : 'Redemptions'}
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!confirm(`${promo.active === 0 ? 'Activate' : 'Deactivate'} promo code ${promo.code}? ${promo.redemption_count} redemptions so far.`)) return
                  try {
                    await api.patch(`/admin/promos/${promo.id}`, { active: promo.active === 0 })
                    load()
                  } catch (err) {
                    alert(`Toggle failed: ${err instanceof ApiError ? err.message : String(err)}`)
                  }
                }}
              >
                {promo.active === 0 ? 'Activate' : 'Deactivate'}
              </Button>
              <Button
                variant="ghost"
                className="text-loss"
                onClick={async () => {
                  if (!confirm(`Delete promo code ${promo.code}? ${promo.redemption_count} redemptions on record will lose their code link. This cannot be undone.`)) return
                  try {
                    await api.del(`/admin/promos/${promo.id}`)
                    load()
                  } catch (err) {
                    alert(`Delete failed: ${err instanceof ApiError ? err.message : String(err)}`)
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>
          {promo.description && <p className="px-4 pb-3 text-[13px] text-muted">{promo.description}</p>}
          {expanded === promo.id && <RedemptionList promoId={promo.id} />}
        </Card>
      ))}
    </div>
  )
}

function RedemptionList({ promoId }: { promoId: string }) {
  const [redemptions, setRedemptions] = useState<Redemption[] | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    setError(false)
    void api.get<{ redemptions: Redemption[] }>(`/admin/promos/${promoId}/redemptions`).then((data) =>
      setRedemptions(data.redemptions),
    ).catch(() => setError(true))
  }, [promoId])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- redemption list load when the row expands
    load()
  }, [load])

  return (
    <div className="border-t border-line">
      {redemptions === null && !error && <p className="px-4 py-3 text-[12px] text-muted">Loading…</p>}
      {error && (
        <p className="flex items-center gap-2 px-4 py-3 text-[12px] text-loss">
          Couldn't load redemptions. <button onClick={load} className="text-accent hover:underline">Retry</button>
        </p>
      )}
      {redemptions?.length === 0 && <p className="px-4 py-3 text-[12px] text-muted">No redemptions yet.</p>}
      {redemptions && redemptions.length > 0 && (
        <div className="flex items-center gap-3 border-b border-line px-4 py-1.5 text-[11px] uppercase tracking-wide text-muted">
          <span>User</span>
          <span>Email</span>
          <span className="ml-auto">Granted</span>
          <span>Scope</span>
          <span>When (local time)</span>
        </div>
      )}
      {redemptions?.map((r, index) => (
        <div key={`${r.username}-${index}`} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
          <span className="text-[12px] text-content">{r.username}</span>
          <span className="num text-[12px] text-muted">{r.email}</span>
          <span className="num ml-auto text-[12px] text-gain">+{r.credits.toLocaleString('en-US')}</span>
          {r.model_label && <span className="text-[12px] text-muted">{r.model_label} only</span>}
          <span className="num text-[12px] text-muted" title={new Date(r.created_at).toLocaleString()}>
            {new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
          </span>
        </div>
      ))}
    </div>
  )
}

function NewPromoForm({ models, onCreated }: { models: ModelAlias[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [credits, setCredits] = useState('50000')
  const [description, setDescription] = useState('')
  const [modelSlug, setModelSlug] = useState('')
  const [maxRedemptions, setMaxRedemptions] = useState('')
  const [perUserLimit, setPerUserLimit] = useState('1')
  const [minAge, setMinAge] = useState('0')
  const [startsAt, setStartsAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [createdMsg, setCreatedMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const creditsValue = Number(credits)
    if (!Number.isInteger(creditsValue) || creditsValue <= 0 || creditsValue > 10_000_000) {
      setError('Credits must be an integer 1–10,000,000.')
      return
    }
    const perUser = Number(perUserLimit)
    if (!Number.isInteger(perUser) || perUser < 1 || perUser > 100) {
      setError('Per-user limit must be an integer 1–100.')
      return
    }
    const minAgeHours = Number(minAge)
    if (!Number.isInteger(minAgeHours) || minAgeHours < 0 || minAgeHours > 24 * 365) {
      setError('Min account age must be an integer 0–8760 hours.')
      return
    }
    let maxRed: number | null = null
    if (maxRedemptions.trim() !== '') {
      maxRed = Number(maxRedemptions)
      if (!Number.isInteger(maxRed) || maxRed < 1 || maxRed > 1_000_000) {
        setError('Max redemptions must be empty or an integer 1–1,000,000.')
        return
      }
    }
    let expiresAtMs: number | null = null
    if (expiresAt) {
      expiresAtMs = new Date(expiresAt).getTime()
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        setError('Expiry must be a future date (your local timezone).')
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      const data = await api.post<{ promo: { code: string } }>('/admin/promos', {
        code,
        credits: creditsValue,
        description: description || undefined,
        model_slug: modelSlug || undefined,
        max_redemptions: maxRed,
        per_user_limit: perUser,
        min_account_age_hours: minAgeHours,
        starts_at: startsAt ? new Date(startsAt).getTime() : null,
        expires_at: expiresAtMs,
      })
      setCode('')
      setDescription('')
      setModelSlug('')
      setMaxRedemptions('')
      setCredits('50000')
      setPerUserLimit('1')
      setMinAge('0')
      setStartsAt('')
      setExpiresAt('')
      setError('')
      setCreatedMsg(`Created code ${data.promo.code} — share it to grant credits.`)
      setOpen(false)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create promo code.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Button onClick={() => { setCreatedMsg(''); setOpen(true) }} className="self-start">
          + New promo code
        </Button>
        {createdMsg && <p role="status" className="text-[13px] text-gain">{createdMsg}</p>}
      </div>
    )
  }

  return (
    <Card className="p-4">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Code">
          <input
            className="input num"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="LAUNCH-2026"
            required
          />
        </Field>
        <Field label="Credits granted">
          <input className="input num" value={credits} onChange={(e) => setCredits(e.target.value)} inputMode="numeric" required />
        </Field>
        <Field label="Scope">
          <select className="input" value={modelSlug} onChange={(e) => setModelSlug(e.target.value)}>
            <option value="">Any model (global balance)</option>
            {models.map((model) => (
              <option key={model.id} value={model.slug}>
                {model.label} only
              </option>
            ))}
          </select>
        </Field>
        <Field label="Max redemptions (blank = unlimited)">
          <input className="input num" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="100" inputMode="numeric" />
        </Field>
        <Field label="Per-user limit">
          <input className="input num" value={perUserLimit} onChange={(e) => setPerUserLimit(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Min account age, hours (0 = brand-new accounts allowed)">
          <input className="input num" value={minAge} onChange={(e) => setMinAge(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Starts (optional, your local timezone — blank = now)">
          <input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Expires (optional, your local timezone)">
          <input className="input" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
        <Field label="Description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Launch week giveaway" />
        </Field>
        {error && <p className="text-[13px] text-loss sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create code'}</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}
