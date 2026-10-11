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
    void load()
  }, [load])

  if (error) return <p className="py-12 text-center text-[13px] text-loss">{error}</p>
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
            <span className={`h-2 w-2 rounded-full ${promo.active ? 'bg-gain' : 'bg-muted'}`} />
            <code className="num rounded bg-surface-2 px-2 py-1 text-[13px] font-semibold">{promo.code}</code>
            <span className="num text-[13px]">+{promo.credits.toLocaleString('en-US')} cr</span>
            {promo.model_label ? (
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">{promo.model_label} only</span>
            ) : (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">any model</span>
            )}
            <span className="num text-[12px] text-muted">
              {promo.redemption_count}
              {promo.max_redemptions != null ? `/${promo.max_redemptions}` : ''} redeemed · {promo.per_user_limit}/user
            </span>
            {promo.min_account_age_hours > 0 && (
              <span className="num text-[12px] text-muted">{promo.min_account_age_hours}h min age</span>
            )}
            {promo.expires_at && (
              <span className="num text-[12px] text-muted">expires {new Date(promo.expires_at).toLocaleDateString()}</span>
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
                  await api.patch(`/admin/promos/${promo.id}`, { active: promo.active === 0 })
                  load()
                }}
              >
                {promo.active === 0 ? 'Activate' : 'Deactivate'}
              </Button>
              <Button
                variant="ghost"
                className="text-loss"
                onClick={async () => {
                  if (!confirm(`Delete promo code ${promo.code}?`)) return
                  await api.del(`/admin/promos/${promo.id}`)
                  load()
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

  useEffect(() => {
    void api.get<{ redemptions: Redemption[] }>(`/admin/promos/${promoId}/redemptions`).then((data) =>
      setRedemptions(data.redemptions),
    )
  }, [promoId])

  return (
    <div className="border-t border-line">
      {redemptions === null && <p className="px-4 py-3 text-[12px] text-muted">Loading…</p>}
      {redemptions?.length === 0 && <p className="px-4 py-3 text-[12px] text-muted">No redemptions yet.</p>}
      {redemptions?.map((r, index) => (
        <div key={`${r.username}-${index}`} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
          <span className="text-[12px] text-content">{r.username}</span>
          <span className="num text-[12px] text-muted">{r.email}</span>
          <span className="num ml-auto text-[12px] text-gain">+{r.credits.toLocaleString('en-US')}</span>
          {r.model_label && <span className="text-[12px] text-muted">{r.model_label}</span>}
          <span className="num text-[12px] text-muted">{new Date(r.created_at).toLocaleString()}</span>
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
  const [expiresAt, setExpiresAt] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/admin/promos', {
        code,
        credits: Number(credits),
        description: description || undefined,
        model_slug: modelSlug || undefined,
        max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
        per_user_limit: Number(perUserLimit),
        min_account_age_hours: Number(minAge),
        expires_at: expiresAt ? new Date(expiresAt).getTime() : null,
      })
      setCode('')
      setDescription('')
      setModelSlug('')
      setMaxRedemptions('')
      setExpiresAt('')
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
      <Button onClick={() => setOpen(true)} className="self-start">
        + New promo code
      </Button>
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
        <Field label="Min account age (hours, anti-farm)">
          <input className="input num" value={minAge} onChange={(e) => setMinAge(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Expires (optional)">
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
