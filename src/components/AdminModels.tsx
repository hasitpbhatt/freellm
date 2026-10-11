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
          using the routing strategy. latency_weighted prefers the lowest average latency and explores
          round-robin ~15% of the time.
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
  const [editingAlias, setEditingAlias] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
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

  async function deleteAlias() {
    if (
      !confirm(
        `Delete alias "${model.label}"? This also deletes its ${model.providers.length} provider config${model.providers.length === 1 ? '' : 's'}.`,
      )
    ) {
      return
    }
    setBusyId(model.id)
    setActionError('')
    try {
      await api.del(`/admin/models/${model.id}`)
      setEditingAlias(false)
      onChanged()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete alias.')
    } finally {
      setBusyId('')
    }
  }

  async function deleteProvider(providerId: string) {
    if (!confirm('Delete this provider config?')) return
    setBusyId(providerId)
    setActionError('')
    try {
      await api.del(`/admin/models/${model.id}/providers/${providerId}`)
      if (editingProviderId === providerId) setEditingProviderId(null)
      onChanged()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete provider config.')
    } finally {
      setBusyId('')
    }
  }

  async function toggleProvider(provider: ModelProvider) {
    setBusyId(provider.id)
    setActionError('')
    try {
      await api.patch(`/admin/models/${model.id}/providers/${provider.id}`, { active: provider.active === 0 })
      onChanged()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update provider config.')
    } finally {
      setBusyId('')
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <span className={`h-2 w-2 rounded-full ${model.active ? 'bg-gain' : 'bg-muted'}`} />
        <h2 className="text-[15px] font-semibold">{model.label}</h2>
        <code className="num rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-muted">{model.slug}</code>
        <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-muted">
          {model.routing.replaceAll('_', ' ')}
        </span>
        <span className={`num rounded px-1.5 py-0.5 text-[12px] ${model.access_tier === 'free' ? 'bg-surface-2 text-muted' : 'bg-accent/10 text-accent'}`}>
          {model.access_tier === 'free' ? 'free' : `🔒 ${model.access_tier}`}
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

      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <Button variant="secondary" size="sm" onClick={() => setEditingAlias((open) => !open)}>
          {editingAlias ? 'Cancel alias edit' : 'Edit alias'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-loss"
          onClick={() => void deleteAlias()}
          disabled={busyId === model.id}
        >
          {busyId === model.id ? 'Deleting…' : 'Delete alias'}
        </Button>
        <span className="num ml-auto text-[12px] text-muted">
          context {model.context_window?.toLocaleString('en-US') ?? '—'} · max out {model.max_output_tokens.toLocaleString('en-US')}
        </span>
      </div>
      {actionError && <p className="px-4 pt-2 text-[12px] text-loss">{actionError}</p>}
      {editingAlias && (
        <EditAliasForm
          model={model}
          onDone={() => setEditingAlias(false)}
          onChanged={() => {
            setEditingAlias(false)
            onChanged()
          }}
        />
      )}

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
                <Button
                  variant="secondary"
                  onClick={() => setEditingProviderId(editingProviderId === provider.id ? null : provider.id)}
                >
                  {editingProviderId === provider.id ? 'Cancel edit' : 'Edit'}
                </Button>
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
              {editingProviderId === provider.id && (
                <EditProviderForm
                  modelId={model.id}
                  provider={provider}
                  onDone={() => setEditingProviderId(null)}
                  onChanged={() => {
                    setEditingProviderId(null)
                    onChanged()
                  }}
                />
              )}
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

function EditAliasForm({
  model,
  onDone,
  onChanged,
}: {
  model: ModelAlias
  onDone: () => void
  onChanged: () => void
}) {
  const [label, setLabel] = useState(model.label)
  const [slug, setSlug] = useState(model.slug)
  const [description, setDescription] = useState(model.description ?? '')
  const [capabilities, setCapabilities] = useState(model.capabilities.join(', '))
  const [contextWindow, setContextWindow] = useState(model.context_window?.toString() ?? '')
  const [maxOutput, setMaxOutput] = useState(model.max_output_tokens.toString())
  const [flatRate, setFlatRate] = useState(model.flat_rate_credits.toString())
  const [routing, setRouting] = useState(model.routing)
  const [accessTier, setAccessTier] = useState(model.access_tier)
  const [active, setActive] = useState(model.active === 1)
  const [sortOrder, setSortOrder] = useState(model.sort_order.toString())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmedLabel = label.trim()
    if (!trimmedLabel || trimmedLabel.length > 80) {
      setError('Label must be 1–80 characters.')
      return
    }
    const context = contextWindow.trim() === '' ? null : Number(contextWindow)
    if (context !== null && (!Number.isInteger(context) || context <= 0)) {
      setError('Context window must be empty or a positive integer.')
      return
    }
    const maxOutputTokens = Number(maxOutput)
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 200_000) {
      setError('Max output tokens must be an integer 256–200,000.')
      return
    }
    const flatRateCredits = Number(flatRate)
    if (!Number.isInteger(flatRateCredits) || flatRateCredits < 0 || flatRateCredits > 1_000_000) {
      setError('Flat rate must be an integer 0–1,000,000 credits.')
      return
    }
    const sort = Number(sortOrder)
    if (!Number.isInteger(sort)) {
      setError('Sort order must be an integer.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/models/${model.id}`, {
        label: trimmedLabel,
        ...(slug.trim() ? { slug: slug.trim() } : {}),
        description: description.trim() ? description.trim() : null,
        capabilities: capabilities
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean),
        context_window: context,
        max_output_tokens: maxOutputTokens,
        flat_rate_credits: flatRateCredits,
        routing,
        access_tier: accessTier,
        active,
        sort_order: sort,
      })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update alias.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-3 border-t border-line p-4 sm:grid-cols-2" onSubmit={submit}>
      <Field label="Label">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required />
      </Field>
      <Field label="Slug (changing this changes API clients)">
        <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} required />
      </Field>
      <Field label="Description">
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder="Empty removes the description"
        />
      </Field>
      <Field label="Capabilities (comma separated)">
        <input className="input" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} />
      </Field>
      <Field label="Context window (tokens, empty = unknown)">
        <input className="input" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} inputMode="numeric" />
      </Field>
      <Field label="Max output tokens">
        <input className="input" value={maxOutput} onChange={(e) => setMaxOutput(e.target.value)} inputMode="numeric" />
      </Field>
      <Field label="Flat rate when provider omits usage">
        <input className="input" value={flatRate} onChange={(e) => setFlatRate(e.target.value)} inputMode="numeric" />
      </Field>
      <Field label="Routing">
        <select className="input" value={routing} onChange={(e) => setRouting(e.target.value as ModelAlias['routing'])}>
          <option value="round_robin">round_robin</option>
          <option value="random">random</option>
          <option value="failover">failover</option>
          <option value="latency_weighted">latency_weighted</option>
        </select>
      </Field>
      <Field label="Access tier (who can use this alias)">
        <select className="input" value={accessTier} onChange={(e) => setAccessTier(e.target.value as ModelAlias['access_tier'])}>
          <option value="free">free — everyone</option>
          <option value="pro">pro — locked</option>
          <option value="enterprise">enterprise — locked</option>
        </select>
      </Field>
      <Field label="Sort order">
        <input className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} inputMode="numeric" />
      </Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active in The Pool
      </label>
      {error && <p className="text-[13px] text-loss sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save alias'}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

function EditProviderForm({
  modelId,
  provider,
  onDone,
  onChanged,
}: {
  modelId: string
  provider: ModelProvider
  onDone: () => void
  onChanged: () => void
}) {
  const [label, setLabel] = useState(provider.label)
  const [baseUrl, setBaseUrl] = useState(provider.base_url)
  const [upstreamModel, setUpstreamModel] = useState(provider.upstream_model)
  const [apiKey, setApiKey] = useState('')
  const [priority, setPriority] = useState(provider.priority.toString())
  const [active, setActive] = useState(provider.active === 1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmedLabel = label.trim()
    if (!trimmedLabel || trimmedLabel.length > 80) {
      setError('Config label must be 1–80 characters.')
      return
    }
    if (!baseUrl.trim() || !upstreamModel.trim()) {
      setError('Base URL and upstream model are required.')
      return
    }
    const priorityValue = Number(priority)
    if (!Number.isInteger(priorityValue)) {
      setError('Priority must be an integer.')
      return
    }

    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/models/${modelId}/providers/${provider.id}`, {
        label: trimmedLabel,
        base_url: baseUrl.trim(),
        upstream_model: upstreamModel.trim(),
        priority: priorityValue,
        active,
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update config.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid w-full gap-3 rounded-lg border border-line bg-surface-2 p-4 sm:grid-cols-2" onSubmit={submit}>
      <Field label="Config label">
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required />
      </Field>
      <Field label="OpenAI-compatible base URL">
        <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
      </Field>
      <Field label="Upstream model name">
        <input className="input" value={upstreamModel} onChange={(e) => setUpstreamModel(e.target.value)} required />
      </Field>
      <Field label={`Rotate bearer key (current: ${provider.key_masked})`}>
        <input
          className="input"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Leave blank to keep the current key"
        />
      </Field>
      <Field label="Priority (failover order, lower first)">
        <input className="input" value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
      </Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active config
      </label>
      {error && <p className="text-[13px] text-loss sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save config'}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

function NewAliasForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [capabilities, setCapabilities] = useState('')
  const [contextWindow, setContextWindow] = useState('')
  const [maxOutput, setMaxOutput] = useState('4096')
  const [flatRate, setFlatRate] = useState('2000')
  const [routing, setRouting] = useState('round_robin')
  const [accessTier, setAccessTier] = useState('free')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const maxOutputTokens = Number(maxOutput)
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 200_000) {
      setError('Max output tokens must be an integer 256–200,000.')
      return
    }
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
        max_output_tokens: maxOutputTokens,
        flat_rate_credits: Number(flatRate),
        routing,
        access_tier: accessTier,
      })
      setLabel('')
      setSlug('')
      setDescription('')
      setCapabilities('')
      setContextWindow('')
      setMaxOutput('4096')
      setFlatRate('2000')
      setRouting('round_robin')
      setAccessTier('free')
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
        <Field label="Max output tokens">
          <input className="input" value={maxOutput} onChange={(e) => setMaxOutput(e.target.value)} placeholder="4096" inputMode="numeric" />
        </Field>
        <Field label="Flat rate when provider omits usage">
          <input className="input" value={flatRate} onChange={(e) => setFlatRate(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Routing">
          <select className="input" value={routing} onChange={(e) => setRouting(e.target.value)}>
            <option value="round_robin">round_robin</option>
            <option value="random">random</option>
            <option value="failover">failover</option>
            <option value="latency_weighted">latency_weighted</option>
          </select>
        </Field>
        <Field label="Access tier">
          <select className="input" value={accessTier} onChange={(e) => setAccessTier(e.target.value)}>
            <option value="free">free — everyone</option>
            <option value="pro">pro — locked</option>
            <option value="enterprise">enterprise — locked</option>
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
