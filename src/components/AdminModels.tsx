import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'
import type { ModelAlias, ModelProvider } from '../lib/types'

type TestResult = { ok: boolean; status: string; latencyMs: number | null; error?: string; mode: string }

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
  disabled: 'bg-muted',
}

function revealProvider(modelId: string, providerId: string): Promise<string> {
  return api.post<{ api_key: string }>(`/admin/models/${modelId}/providers/${providerId}/reveal`)
    .then((res) => res.api_key)
}

export default function AdminModels() {
  const [models, setModels] = useState<ModelAlias[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ models: ModelAlias[] }>('/admin/models')
      setModels(data.models)
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?next=/admin'
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load the model catalog.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <p className="py-12 text-center text-[13px] text-loss">{error}</p>
  if (models === null) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Model catalog</h1>
        <p className="mt-1 text-[13px] text-muted">
          Aliases group multiple upstream configs. A request to an alias multiplexes across its configs
          using the routing strategy.
        </p>
      </div>

      <NewAliasForm onCreated={load} />

      {models.length === 0 && (
        <Card className="p-8 text-center text-[13px] text-muted">
          No aliases yet. Create one above, then add provider configs to it.
        </Card>
      )}

      {models.map((model) => (
        <AliasCard key={model.id} model={model} onChanged={load} />
      ))}
    </div>
  )
}

function AliasCard({ model, onChanged }: { model: ModelAlias; onChanged: () => void }) {
  const [busyId, setBusyId] = useState('')
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})

  async function testProvider(providerId: string) {
    setBusyId(providerId)
    try {
      const data = await api.post<{ test: TestResult }>(`/admin/models/${model.id}/providers/${providerId}/test`)
      setTestResults((prev) => ({ ...prev, [providerId]: data.test }))
      onChanged()
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [providerId]: {
          ok: false,
          status: 'down',
          latencyMs: null,
          error: err instanceof ApiError ? err.message : 'Test failed',
          mode: '-',
        },
      }))
    } finally {
      setBusyId('')
    }
  }

  async function revealProviderKey(providerId: string) {
    setBusyId(providerId)
    try {
      const key = await revealProvider(model.id, providerId)
      navigator.clipboard.writeText(key)
      alert(`Key copied to clipboard:\n${key}`)
    } catch (err) {
      alert(`Reveal failed: ${err instanceof ApiError ? err.message : String(err)}`)
    } finally {
      setBusyId('')
    }
  }

  async function deleteProvider(providerId: string) {
    if (!confirm('Delete this provider config?')) return
    await api.del(`/admin/models/${model.id}/providers/${providerId}`)
    onChanged()
  }

  async function toggleProvider(provider: ModelProvider) {
    setBusyId(provider.id)
    await api.patch(`/admin/models/${model.id}/providers/${provider.id}`, { active: provider.active === 0 })
    onChanged()
    setBusyId('')
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <span className={`h-2 w-2 rounded-full ${model.active ? 'bg-gain' : 'bg-muted'}`} />
        <h2 className="text-[15px] font-semibold">{model.label}</h2>
        <code className="num rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-muted">{model.slug}</code>
        <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-muted">
          {model.routing.replace('_', ' ')}
        </span>
        <span className="num text-[12px] text-muted">flat {model.flat_rate_credits.toLocaleString('en-US')} cr</span>
        {model.capabilities.map((tag) => (
          <span key={tag} className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent">
            {tag}
          </span>
        ))}
        <span className="ml-auto text-[12px] text-muted">
          {model.providers.length} config{model.providers.length === 1 ? '' : 's'}
        </span>
      </div>

      {model.description && <p className="px-4 pt-3 text-[13px] text-muted">{model.description}</p>}

      <div className="flex flex-col divide-y divide-line">
        {model.providers.map((provider) => {
          const test = testResults[provider.id]
          return (
            <div key={provider.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className={`h-2 w-2 rounded-full ${statusDot[provider.status]}`} />
              <div className="flex min-w-[240px] flex-1 flex-col">
                <span className="text-[13px] font-medium">{provider.label}</span>
                <span className="num text-[12px] text-muted">
                  {provider.base_url} · {provider.upstream_model}
                </span>
              </div>
              <span className="num text-[12px] text-muted">{provider.key_masked}</span>
              {provider.avg_latency_ms != null && (
                <span className="num text-[12px] text-muted">{provider.avg_latency_ms}ms</span>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => testProvider(provider.id)} disabled={busyId === provider.id}>
                  {busyId === provider.id ? 'Testing…' : 'Test'}
                </Button>
                <Button variant="ghost" onClick={() => revealProviderKey(provider.id)} disabled={busyId === provider.id} className="text-accent">
                  {busyId === provider.id ? 'Revealing…' : 'Reveal'}
                </Button>
                <Button variant="ghost" onClick={() => toggleProvider(provider)} disabled={busyId === provider.id}>
                  {provider.active === 0 ? 'Enable' : 'Disable'}
                </Button>
                <Button variant="ghost" onClick={() => deleteProvider(provider.id)} className="text-loss">
                  Delete
                </Button>
              </div>
              {test && (
                <p className={`w-full text-[12px] ${test.ok ? 'text-gain' : 'text-loss'}`}>
                  {test.ok ? `OK via /${test.mode}` : 'Failed'} · {test.latencyMs ?? '—'}ms
                  {test.error ? ` — ${test.error}` : ''}
                </p>
              )}
              {provider.last_error && !test && (
                <p className="w-full text-[12px] text-muted">Last error: {provider.last_error}</p>
              )}
            </div>
          )
        })}
        {model.providers.length === 0 && (
          <p className="px-4 py-4 text-[13px] text-muted">No provider configs yet — add one below.</p>
        )}
      </div>

      <AddProviderForm modelId={model.id} onCreated={onChanged} />
    </Card>
  )
}

function NewAliasForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [capabilities, setCapabilities] = useState('')
  const [contextWindow, setContextWindow] = useState('')
  const [flatRate, setFlatRate] = useState('2000')
  const [routing, setRouting] = useState('round_robin')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/admin/models', {
        label,
        slug: slug || undefined,
        description: description || undefined,
        capabilities: capabilities
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
        context_window: contextWindow ? Number(contextWindow) : null,
        flat_rate_credits: Number(flatRate),
        routing,
      })
      setLabel('')
      setSlug('')
      setDescription('')
      setCapabilities('')
      setContextWindow('')
      setOpen(false)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create alias.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="self-start">
        + New model alias
      </Button>
    )
  }

  return (
    <Card className="p-4">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Label">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Poolside Laguna" required />
        </Field>
        <Field label="Slug (alias id, auto from label)">
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="poolside-laguna" />
        </Field>
        <Field label="Description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Coding model from Poolside" />
        </Field>
        <Field label="Capabilities (comma separated)">
          <input className="input" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="coding, fast" />
        </Field>
        <Field label="Context window (tokens, optional)">
          <input className="input" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} placeholder="128000" inputMode="numeric" />
        </Field>
        <Field label="Flat rate when provider omits usage">
          <input className="input" value={flatRate} onChange={(e) => setFlatRate(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Routing">
          <select className="input" value={routing} onChange={(e) => setRouting(e.target.value)}>
            <option value="round_robin">round_robin</option>
            <option value="random">random</option>
            <option value="failover">failover</option>
          </select>
        </Field>
        {error && <p className="text-[13px] text-loss sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create alias'}</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

function AddProviderForm({ modelId, onCreated }: { modelId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [upstreamModel, setUpstreamModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [priority, setPriority] = useState('0')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post(`/admin/models/${modelId}/providers`, {
        label: label || baseUrl,
        base_url: baseUrl,
        upstream_model: upstreamModel,
        api_key: apiKey,
        priority: Number(priority),
      })
      setLabel('')
      setBaseUrl('')
      setUpstreamModel('')
      setApiKey('')
      setOpen(false)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add config.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="px-4 py-3">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          + Add provider config
        </Button>
      </div>
    )
  }

  return (
    <div className="border-t border-line p-4">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Config label (optional)">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="pool-key-1" />
        </Field>
        <Field label="OpenAI-compatible base URL">
          <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.poolside.ai/v1" required />
        </Field>
        <Field label="Upstream model name">
          <input className="input" value={upstreamModel} onChange={(e) => setUpstreamModel(e.target.value)} placeholder="poolside-laguna-2026-01" required />
        </Field>
        <Field label="Bearer key">
          <input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" required />
        </Field>
        <Field label="Priority (failover order, lower first)">
          <input className="input" value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
        </Field>
        {error && <p className="text-[13px] text-loss sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add config'}</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  )
}
