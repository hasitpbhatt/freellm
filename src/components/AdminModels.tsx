import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'
import type { ModelAlias, ModelProvider } from '../lib/types'

type TestResult = { ok: boolean; status: string; latencyMs: number | null; error?: string; mode: string }

/** Human retry cooldown: null = global 30m default, 0 = retry immediately. */
function formatCooldown(ms: number | null): string {
  if (ms == null) return 'retry default 30m'
  if (ms === 0) return 'retry now'
  if (ms % 86_400_000 === 0) return `retry ${ms / 86_400_000}d`
  if (ms % 3_600_000 === 0) return `retry ${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `retry ${ms / 60_000}m`
  return `retry ${ms}ms`
}

function msToMinutesInput(ms: number | null): string {
  if (ms == null) return ''
  return String(ms / 60000)
}

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
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const busy = (key: string) => busyKey === key
  const [editingAlias, setEditingAlias] = useState(false)
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ providerId: string; label: string; key: string } | null>(null)
  const [actionError, setActionError] = useState('')
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})

  async function testProvider(providerId: string) {
    setBusyKey(`test:${providerId}`)
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
      setBusyKey(null)
    }
  }

  async function revealProviderKey(provider: ModelProvider) {
    if (!confirm(`Reveal the bearer key for "${provider.label}"? It will be shown on screen — make sure nobody is watching.`)) return
    setBusyKey(`reveal:${provider.id}`)
    setActionError('')
    try {
      const key = await revealProvider(model.id, provider.id)
      setRevealed({ providerId: provider.id, label: provider.label, key })
      try {
        await navigator.clipboard.writeText(key)
      } catch {
        // clipboard denied — key stays visible below for manual copy
      }
    } catch (err) {
      setActionError(`Reveal failed: ${err instanceof ApiError ? err.message : String(err)}`)
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteAlias() {
    const labels = model.providers.map((p) => p.label).join(', ') || 'none'
    if (
      !confirm(
        `Delete alias "${model.label}" (${model.slug})? This also deletes its ${model.providers.length} provider config${model.providers.length === 1 ? '' : 's'}: ${labels}. This cannot be undone.`,
      )
    ) {
      return
    }
    setBusyKey(`delete-alias:${model.id}`)
    setActionError('')
    try {
      await api.del(`/admin/models/${model.id}`)
      setEditingAlias(false)
      onChanged()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete alias.')
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteProvider(provider: ModelProvider) {
    if (!confirm(`Delete provider config "${provider.label}" (${provider.base_url} · ${provider.upstream_model})? This cannot be undone.`)) return
    setBusyKey(`delete:${provider.id}`)
    setActionError('')
    try {
      await api.del(`/admin/models/${model.id}/providers/${provider.id}`)
      if (editingProviderId === provider.id) setEditingProviderId(null)
      if (revealed?.providerId === provider.id) setRevealed(null)
      onChanged()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete provider config.')
    } finally {
      setBusyKey(null)
    }
  }

  async function toggleProvider(provider: ModelProvider) {
    setBusyKey(`toggle:${provider.id}`)
    setActionError('')
    try {
      await api.patch(`/admin/models/${model.id}/providers/${provider.id}`, { active: provider.active === 0 })
      onChanged()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update provider config.')
    } finally {
      setBusyKey(null)
    }
  }

  type ProviderGroup = { key: string; base_url: string; upstream_model: string; members: ModelProvider[] }

  // Club configs that differ only by bearer key (same endpoint + model) so a
  // pool of keys reads as one unit instead of N near-identical rows.
  const groups: ProviderGroup[] = []
  for (const p of model.providers) {
    const key = `${p.base_url}||${p.upstream_model}`
    const existing = groups.find((g) => g.key === key)
    if (existing) existing.members.push(p)
    else groups.push({ key, base_url: p.base_url, upstream_model: p.upstream_model, members: [p] })
  }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [keyPreset, setKeyPreset] = useState<{ baseUrl: string; upstreamModel: string; nonce: number } | null>(null)

  function groupStatus(members: ModelProvider[]): string {
    const statuses = members.map((m) => (m.active === 0 ? 'disabled' : m.status))
    if (statuses.includes('live')) return 'live'
    if (statuses.includes('slow')) return 'slow'
    if (statuses.includes('unknown')) return 'unknown'
    if (statuses.includes('down')) return 'down'
    return 'disabled'
  }

  async function testGroup(members: ModelProvider[]) {
    for (const m of members) {
      await testProvider(m.id)
    }
  }

  const renderProviderRow = (provider: ModelProvider) => {
    const test = testResults[provider.id]
    return (
      <div key={provider.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className={`h-2 w-2 rounded-full ${statusDot[provider.status]}`} aria-hidden="true" />
        <span className="sr-only">{provider.status}</span>
        <div className="flex min-w-[240px] flex-1 flex-col">
          <span className="text-[13px] font-medium">{provider.label}</span>
          <span className="num text-[12px] text-muted">
            {provider.base_url} · {provider.upstream_model}
          </span>
        </div>
        <span className="num text-[12px] text-muted">{provider.key_masked}</span>
        {provider.avg_latency_ms != null && (
          <span className="num text-[12px] text-muted" title="Rolling average stream latency — latency_weighted routing prefers the lowest">
            {provider.avg_latency_ms}ms avg
          </span>
        )}
        {provider.cooldown_ms != null && (
          <span className="num text-[12px] text-muted" title="How long this config waits before retry after a failure (doubles per consecutive failure)">
            {formatCooldown(provider.cooldown_ms)}
          </span>
        )}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setEditingProviderId(editingProviderId === provider.id ? null : provider.id)}
          >
            {editingProviderId === provider.id ? 'Cancel edit' : 'Edit'}
          </Button>
          <Button variant="secondary" onClick={() => testProvider(provider.id)} disabled={busyKey !== null}>
            {busy(`test:${provider.id}`) ? 'Testing…' : 'Test'}
          </Button>
          <Button variant="ghost" onClick={() => revealProviderKey(provider)} disabled={busyKey !== null} className="text-accent">
            {busy(`reveal:${provider.id}`) ? 'Revealing…' : 'Reveal'}
          </Button>
          <Button variant="ghost" onClick={() => toggleProvider(provider)} disabled={busyKey !== null}>
            {busy(`toggle:${provider.id}`) ? 'Saving…' : provider.active === 0 ? 'Enable' : 'Disable'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setKeyPreset({ baseUrl: provider.base_url, upstreamModel: provider.upstream_model, nonce: Date.now() })}
            disabled={busyKey !== null}
            title="Add another key for this same endpoint and model"
          >
            Clone key
          </Button>
          <Button variant="ghost" onClick={() => deleteProvider(provider)} disabled={busyKey !== null} className="text-loss">
            {busy(`delete:${provider.id}`) ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
        {revealed?.providerId === provider.id && (
          <div className="flex w-full flex-col gap-2 rounded-lg border border-warn/40 bg-warn/5 p-3">
            <p className="text-[12px] text-warn">
              Bearer key for "{revealed.label}" — copied to clipboard when possible. Clear it from the clipboard after use.
            </p>
            <div className="flex items-center gap-2">
              <code className="num flex-1 break-all text-[12px]">{revealed.key}</code>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { void navigator.clipboard.writeText(revealed.key).catch(() => {}) }}
              >
                Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>
                Hide
              </Button>
            </div>
          </div>
        )}
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
            {test.ok ? `OK via ${test.mode === 'models' ? 'model list probe' : test.mode === 'chat' ? 'chat probe' : test.mode}` : 'Failed'} · {test.latencyMs ?? '—'}ms
            {test.error ? ` — ${test.error}` : ''}
          </p>
        )}
        {provider.last_error && (
          <p className="w-full text-[12px] text-muted">Last error: {provider.last_error}</p>
        )}
      </div>
    )
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <span className={`h-2 w-2 rounded-full ${model.active ? 'bg-gain' : 'bg-muted'}`} aria-hidden="true" />
        <span className="sr-only">{model.active ? 'Active' : 'Inactive'} alias. </span>
        <h2 className="text-[15px] font-semibold">{model.label}</h2>
        <code className="num rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-muted">{model.slug}</code>
        <span className="num rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-muted">
          {model.routing.replaceAll('_', ' ')}
        </span>
        <span className={`num rounded px-1.5 py-0.5 text-[12px] ${model.access_tier === 'free' ? 'bg-surface-2 text-muted' : 'bg-accent/10 text-accent'}`}>
          {model.access_tier === 'free' ? 'free' : `🔒 ${model.access_tier}`}
        </span>
        {model.scoped_only === 1 && (
          <span className="num rounded bg-accent/10 px-1.5 py-0.5 text-[12px] text-accent" title="Spends this alias's scoped credits only — global balance cannot buy in">
            scoped only
          </span>
        )}
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
          disabled={busy(`delete-alias:${model.id}`)}
        >
          {busy(`delete-alias:${model.id}`) ? 'Deleting…' : 'Delete alias'}
        </Button>
        <span className="num ml-auto text-[12px] text-muted">
          context {model.context_window?.toLocaleString('en-US') ?? '—'} · max out {model.max_output_tokens.toLocaleString('en-US')}
        </span>
      </div>
      {actionError && <p role="alert" className="px-4 pt-2 text-[12px] text-loss">{actionError}</p>}
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
        {groups.map((group) => {
          if (group.members.length === 1) return renderProviderRow(group.members[0])
          const status = groupStatus(group.members)
          const served = group.members.reduce((sum, m) => sum + m.messages_served, 0)
          const isCollapsed = collapsed[group.key] === true
          return (
            <div key={group.key} className="border-b border-line last:border-0">
              <div className="flex flex-wrap items-center gap-2 bg-surface-2/50 px-4 py-2">
                <button
                  onClick={() => setCollapsed((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
                  aria-expanded={!isCollapsed}
                  className="rounded px-1 text-[13px] text-muted hover:text-content"
                  aria-label={isCollapsed ? `Expand ${group.members.length} keys` : `Collapse ${group.members.length} keys`}
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
                <span className={`h-2 w-2 rounded-full ${statusDot[status]}`} aria-hidden="true" />
                <span className="sr-only">Club status {status}: </span>
                <span className="num text-[12px] text-muted">
                  {group.base_url} · {group.upstream_model}
                </span>
                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
                  {group.members.length} keys, one endpoint
                </span>
                <span className="num text-[12px] text-muted">{served.toLocaleString('en-US')} served</span>
                <span className="ml-auto flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void testGroup(group.members)} disabled={busyKey !== null}>
                    Test all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setKeyPreset({ baseUrl: group.base_url, upstreamModel: group.upstream_model, nonce: Date.now() })}
                    disabled={busyKey !== null}
                  >
                    + Add key
                  </Button>
                </span>
              </div>
              {!isCollapsed && group.members.map((member) => renderProviderRow(member))}
            </div>
          )
        })}
        {model.providers.length === 0 && (
          <p className="px-4 py-4 text-[13px] text-muted">No provider configs yet — add one below.</p>
        )}
      </div>

      <AddProviderForm modelId={model.id} preset={keyPreset} onCreated={() => { setKeyPreset(null); onChanged() }} />
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
  const [scopedOnly, setScopedOnly] = useState(model.scoped_only === 1)
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
        scoped_only: scopedOnly,
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
      <Field label="Slug — changing this breaks existing API clients using the old name">
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
      <Field label="Capabilities (comma separated, saved lowercase)">
        <input className="input" value={capabilities} onChange={(e) => setCapabilities(e.target.value)} placeholder="coding, fast" />
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
      <Field label="Routing — how requests spread across configs">
        <select className="input" value={routing} onChange={(e) => setRouting(e.target.value as ModelAlias['routing'])}>
          <option value="round_robin">round_robin — even rotation</option>
          <option value="random">random — uniform shuffle</option>
          <option value="failover">failover — priority order, lower first</option>
          <option value="latency_weighted">latency_weighted — fastest first, 15% exploring</option>
        </select>
      </Field>
      <Field label="Access tier (who can use this alias)">
        <select className="input" value={accessTier} onChange={(e) => setAccessTier(e.target.value as ModelAlias['access_tier'])}>
          <option value="free">free — everyone</option>
          <option value="pro">pro — locked</option>
          <option value="enterprise">enterprise — locked</option>
        </select>
      </Field>
      <p className="text-[12px] text-muted sm:col-span-2">
        Access tier gates <em>who</em> may call; scoped-only gates <em>what pays</em> (scoped promo
        credits only — combine both to lock premium capacity like luna).
      </p>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={scopedOnly} onChange={(e) => setScopedOnly(e.target.checked)} />
        Scoped-only payment (global credits can't buy this alias)
      </label>
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
  const [cooldownMinutes, setCooldownMinutes] = useState(msToMinutesInput(provider.cooldown_ms))
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
    let cooldownMs: number | null = null
    if (cooldownMinutes.trim() !== '') {
      const minutes = Number(cooldownMinutes)
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
        setError('Retry cooldown must be empty (default) or an integer 0–10080 minutes.')
        return
      }
      cooldownMs = minutes * 60000
    }

    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/models/${modelId}/providers/${provider.id}`, {
        label: trimmedLabel,
        base_url: baseUrl.trim(),
        upstream_model: upstreamModel.trim(),
        priority: priorityValue,
        cooldown_ms: cooldownMs,
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
      <Field label="Priority (failover order, lower first — ignored by other routing modes)">
        <input className="input" value={priority} onChange={(e) => setPriority(e.target.value)} inputMode="numeric" />
      </Field>
      <Field label="Retry cooldown, minutes (empty = default 30m, e.g. 1440 for daily quotas)">
        <input className="input" value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} inputMode="numeric" placeholder="default" />
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
  const [scopedOnly, setScopedOnly] = useState(false)
  const [createdMsg, setCreatedMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!label.trim() || label.trim().length > 80) {
      setError('Label must be 1–80 characters.')
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
    if (contextWindow.trim() !== '') {
      const context = Number(contextWindow)
      if (!Number.isInteger(context) || context <= 0) {
        setError('Context window must be empty or a positive integer.')
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      const data = await api.post<{ model: { label: string } }>('/admin/models', {
        label: label.trim(),
        slug: slug || undefined,
        description: description || undefined,
        capabilities: capabilities
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean),
        context_window: contextWindow ? Number(contextWindow) : null,
        max_output_tokens: maxOutputTokens,
        flat_rate_credits: flatRateCredits,
        routing,
        access_tier: accessTier,
        scoped_only: scopedOnly,
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
      setScopedOnly(false)
      setCreatedMsg(`Created alias "${data.model.label}" — add provider configs to it below.`)
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
      <div className="flex flex-col items-start gap-2">
        <Button onClick={() => { setCreatedMsg(''); setOpen(true) }} className="self-start">
          + New model alias
        </Button>
        {createdMsg && <p role="status" className="text-[13px] text-gain">{createdMsg}</p>}
      </div>
    )
  }

  return (
    <Card className="p-4">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <Field label="Label">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Poolside Laguna" required />
        </Field>
        <Field label="Slug (alias id — leave blank to auto-generate from the label)">
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
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={scopedOnly} onChange={(e) => setScopedOnly(e.target.checked)} />
          Scoped-only payment (global credits can't buy this alias)
        </label>
        {error && <p className="text-[13px] text-loss sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create alias'}</Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

function AddProviderForm({
  modelId,
  preset,
  onCreated,
}: {
  modelId: string
  preset: { baseUrl: string; upstreamModel: string; nonce: number } | null
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [upstreamModel, setUpstreamModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [priority, setPriority] = useState('0')
  const [cooldownMinutes, setCooldownMinutes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Clone / add-key-to-club: prefill the endpoint, operator only adds the bearer.
  useEffect(() => {
    if (!preset) return
    setBaseUrl(preset.baseUrl)
    setUpstreamModel(preset.upstreamModel)
    setOpen(true)
  }, [preset])

  async function submit(event: FormEvent) {
    event.preventDefault()
    let cooldownMs: number | null = null
    if (cooldownMinutes.trim() !== '') {
      const minutes = Number(cooldownMinutes)
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
        setError('Retry cooldown must be empty (default) or an integer 0–10080 minutes.')
        return
      }
      cooldownMs = minutes * 60000
    }
    setBusy(true)
    setError('')
    try {
      await api.post(`/admin/models/${modelId}/providers`, {
        label: label || baseUrl,
        base_url: baseUrl,
        upstream_model: upstreamModel,
        api_key: apiKey,
        priority: Number(priority),
        cooldown_ms: cooldownMs,
      })
      setLabel('')
      setBaseUrl('')
      setUpstreamModel('')
      setApiKey('')
      setPriority('0')
      setCooldownMinutes('')
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
        <Field label="Config label (optional — blank uses the base URL)">
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
        <Field label="Retry cooldown, minutes (empty = default 30m, e.g. 1440 for daily quotas)">
          <input className="input" value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} inputMode="numeric" placeholder="default" />
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
