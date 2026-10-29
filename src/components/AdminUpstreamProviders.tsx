import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'
import type { UpstreamModel, UpstreamProvider, UpstreamKey } from '../lib/types'

// Upstream providers: the shared building blocks of the new schema.
// A provider (label + base URL + N bearer keys) is created here once, then
// mapped into any number of aliases with different upstream model names — no
// more re-pasting the same endpoint and key for every alias.
type TestResult = { ok: boolean; status: string; latencyMs: number | null; error?: string; mode: string }

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
  disabled: 'bg-muted',
}

/** Human retry cooldown: null = global 30m default, 0 = retry immediately. */
function formatCooldown(ms: number | null): string {
  if (ms == null) return 'retry default 30m'
  if (ms === 0) return 'retry now'
  if (ms % 86_400_000 === 0) return `retry ${ms / 86_400_000}d`
  if (ms % 3_600_000 === 0) return `retry ${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `retry ${ms / 60_000}m`
  return `retry ${ms}ms`
}

function minutesInput(ms: number | null): string {
  return ms == null ? '' : String(Math.round(ms / 60000))
}

export default function AdminUpstreamProviders() {
  const [providers, setProviders] = useState<UpstreamProvider[] | null>(null)
  const [models, setModels] = useState<UpstreamModel[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [managingId, setManagingId] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [revealed, setRevealed] = useState<{ id: string; keys: UpstreamKey[] } | null>(null)

  const load = useCallback(async () => {
    try {
      const [providerData, modelData] = await Promise.all([
        api.get<{ providers: UpstreamProvider[] }>('/admin/upstream-providers'),
        api.get<{ models: UpstreamModel[] }>('/admin/upstream-models'),
      ])
      setProviders(providerData.providers)
      setModels(modelData.models)
      setError('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?next=/admin'
        return
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load upstream providers.')
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- provider list load on mount
    void load()
  }, [load])

  async function testProvider(id: string) {
    setBusyKey(`test:${id}`)
    setActionError('')
    try {
      const data = await api.post<{ test: TestResult }>(`/admin/upstream-providers/${id}/test`)
      setTestResults((prev) => ({ ...prev, [id]: data.test }))
      await load()
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, status: 'down', latencyMs: null, error: err instanceof ApiError ? err.message : 'Test failed', mode: '-' },
      }))
    } finally {
      setBusyKey(null)
    }
  }

  async function revealKeys(provider: UpstreamProvider) {
    if (!confirm(`Reveal the bearer keys for "${provider.label}"? They will be shown on screen — make sure nobody is watching.`)) return
    setBusyKey(`reveal:${provider.id}`)
    setActionError('')
    try {
      const data = await api.post<{ keys: UpstreamKey[] }>(`/admin/upstream-providers/${provider.id}/reveal`)
      setRevealed({ id: provider.id, keys: data.keys })
      try {
        // Copy the first key to clipboard
        await navigator.clipboard.writeText(data.keys[0]?.api_key ?? '')
      } catch {
        // clipboard denied — keys stay visible below for manual copy
      }
    } catch (err) {
      setActionError(`Reveal failed: ${err instanceof ApiError ? err.message : String(err)}`)
    } finally {
      setBusyKey(null)
    }
  }

  async function deleteProvider(provider: UpstreamProvider) {
    if (!confirm(`Delete upstream provider "${provider.label}"? Any alias configs still using it must be removed first. This cannot be undone.`)) return
    setBusyKey(`delete:${provider.id}`)
    setActionError('')
    try {
      await api.del(`/admin/upstream-providers/${provider.id}`)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete provider.')
    } finally {
      setBusyKey(null)
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-[13px] text-loss" role="alert">{error}</p>
        <Button onClick={() => void load()} className="mt-4">Retry</Button>
      </div>
    )
  }
  if (providers === null) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Upstream providers</h1>
        <p className="mt-1 text-[13px] text-muted">
          The shared endpoints behind your aliases. Create a provider here once — name, base URL, and bearer
          keys — then map it into any alias with one of its upstream models. Health, cooldown, and latency
          are tracked per provider across every alias that uses it.
        </p>
      </div>

      <ProviderForm
        open={creating}
        onOpenChange={setCreating}
        onSaved={async () => {
          setCreating(false)
          await load()
        }}
      />

      {providers.length === 0 && (
        <Card className="p-8 text-center text-[13px] text-muted">
          No upstream providers yet. Add one above — then map it into aliases from the Model catalog tab.
        </Card>
      )}

      {providers.map((provider) => (
        <Card key={provider.id}>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <span className={`h-2 w-2 rounded-full ${statusDot[provider.status]}`} aria-hidden="true" />
            <span className="sr-only">{provider.status}</span>
            <h2 className="text-[15px] font-semibold">{provider.label}</h2>
            <code className="num rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-muted">{provider.base_url}</code>
            <span className="num text-[12px] text-muted">{provider.key_masked ?? (provider.key_count === 0 ? 'no keys' : '••••')}</span>
            {provider.avg_latency_ms != null && (
              <span className="num text-[12px] text-muted" title="Rolling average stream latency across all aliases using this provider">
                {provider.avg_latency_ms}ms avg
              </span>
            )}
            <span className="num text-[12px] text-muted" title="How long this provider waits before retry after a failure (doubles per consecutive failure)">
              {formatCooldown(provider.cooldown_base_ms)}
            </span>
            <span className="num text-[12px] text-muted">
              {models.filter((m) => m.upstream_provider_id === provider.id).length} model{models.filter((m) => m.upstream_provider_id === provider.id).length === 1 ? '' : 's'}
            </span>
            <span className="num text-[12px] text-muted">{provider.key_count ?? 0} key{provider.key_count === 1 ? '' : 's'}</span>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => void testProvider(provider.id)} disabled={busyKey !== null}>
                {busyKey === `test:${provider.id}` ? 'Testing…' : 'Test'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void revealKeys(provider)} disabled={busyKey !== null} className="text-accent">
                Reveal keys
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setEditingId(editingId === provider.id ? null : provider.id)}>
                {editingId === provider.id ? 'Cancel edit' : 'Edit'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void deleteProvider(provider)} disabled={busyKey !== null} className="text-loss">
                Delete
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setManagingId(managingId === provider.id ? null : provider.id)}>
                {managingId === provider.id ? 'Close models' : 'Models'}
              </Button>
            </div>
          </div>

          {actionError && <p role="alert" className="px-4 pt-2 text-[12px] text-loss">{actionError}</p>}

          {editingId === provider.id && (
            <ProviderForm
              open
              provider={provider}
              onOpenChange={(open) => { if (!open) setEditingId(null) }}
              onSaved={async () => {
                setEditingId(null)
                await load()
              }}
            />
          )}

          {revealed?.id === provider.id && (
            <div className="flex flex-col gap-2 border-b border-line bg-warn/5 p-4">
              <p className="text-[12px] text-warn">
                Bearer keys for "{provider.label}" — copied to clipboard when possible. Clear them from the clipboard after use.
              </p>
              <div className="flex flex-col gap-2">
                {revealed.keys.map((k) => {
                    const keyText = k.api_key ?? ''
                    return (
                      <div key={k.id} className="flex items-center gap-2">
                        <span className="text-[12px] text-muted">{k.label}:</span>
                        <code className="num flex-1 break-all text-[12px]">{keyText}</code>
                        <Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard.writeText(keyText).catch(() => {}) }}>
                          Copy
                        </Button>
                      </div>
                    )
                  })}
                <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>Hide</Button>
              </div>
            </div>
          )}

          {testResults[provider.id] && (
            <p className={`w-full px-4 pt-2 text-[12px] ${testResults[provider.id].ok ? 'text-gain' : 'text-loss'}`}>
              {testResults[provider.id].ok ? 'OK' : 'Failed'} · {testResults[provider.id].latencyMs ?? '—'}ms
              {testResults[provider.id].error ? ` — ${testResults[provider.id].error}` : ''}
            </p>
          )}
          {provider.last_error && <p className="w-full px-4 pt-1 text-[12px] text-muted">Last error: {provider.last_error}</p>}

          {managingId === provider.id && (
            <ModelCatalog
              provider={provider}
              models={models.filter((m) => m.upstream_provider_id === provider.id)}
              allProviders={providers}
              onChanged={load}
            />
          )}
        </Card>
      ))}
    </div>
  )
}

function ProviderForm({
  open,
  provider,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  provider?: UpstreamProvider
  onOpenChange: (open: boolean) => void
  onSaved: () => void | Promise<void>
}) {
  const editing = !!provider
  const [label, setLabel] = useState(provider?.label ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '')
  const [apiKey, setApiKey] = useState('')
  const [cooldownMinutes, setCooldownMinutes] = useState(minutesInput(provider?.cooldown_base_ms ?? null))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Re-sync when a different provider is opened for editing.
  useEffect(() => {
    if (!provider) return
    // oxlint-disable-next-line react/set-state-in-effect -- syncing from external prop object, not a derived local state
    setLabel(provider.label)
    setBaseUrl(provider.base_url)
    setApiKey('')
    setCooldownMinutes(minutesInput(provider.cooldown_base_ms))
  }, [provider])

  async function addKey() {
    if (!provider) return
    if (!apiKey.trim()) {
      setError('A bearer key is required to add to the pool.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.post(`/admin/upstream-providers/${provider.id}/keys`, {
        api_key: apiKey.trim(),
        label: `key-${Date.now()}`,
      })
      setApiKey('')
      await onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add key.')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!label.trim() || label.trim().length > 80) {
      setError('Label must be 1–80 characters.')
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
    if (!editing && !apiKey.trim()) {
      setError('A bearer key is required when creating a provider.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const payload: Record<string, unknown> = { label: label.trim(), cooldown_base_ms: cooldownMs }
      if (!editing) {
        payload.base_url = baseUrl.trim()
        payload.api_key = apiKey.trim()
      } else {
        if (baseUrl.trim() && baseUrl.trim() !== provider!.base_url) payload.base_url = baseUrl.trim()
        if (apiKey.trim()) payload.api_key = apiKey.trim()
      }
      if (editing) await api.patch(`/admin/upstream-providers/${provider!.id}`, payload)
      else await api.post('/admin/upstream-providers', payload)
      setLabel('')
      setBaseUrl('')
      setApiKey('')
      setCooldownMinutes('')
      await onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : editing ? 'Failed to update provider.' : 'Failed to create provider.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    if (editing) return null
    return (
      <Card className="p-4">
        <Button onClick={() => onOpenChange(true)}>+ New upstream provider</Button>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <p className="text-[13px] font-medium sm:col-span-2">{editing ? `Edit "${provider!.label}"` : 'New upstream provider'}</p>
        <Field label="Label">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Poolside API" required />
        </Field>
        <Field label="OpenAI-compatible base URL">
          <input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.poolside.ai/v1" required={!editing} />
        </Field>
        <Field label={editing ? `Rotate/add bearer key (current: ${provider!.key_masked ?? '••••'})` : 'Bearer key'}>
          <input
            className="input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={editing ? 'Leave blank to keep the current key' : 'sk-…'}
            required={!editing}
          />
        </Field>
        <Field label="Retry cooldown, minutes (empty = default 30m, e.g. 1440 for daily quotas)">
          <input className="input" value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} inputMode="numeric" placeholder="default" />
        </Field>
        {editing && provider && provider.key_count !== undefined && (
          <Field label="Key pool" className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted">Pool has {provider.key_count} key{provider.key_count === 1 ? '' : 's'}</span>
              <Button type="button" variant="secondary" size="sm" onClick={addKey} disabled={busy}>
                {busy ? 'Adding…' : 'Add key to pool'}
              </Button>
            </div>
            {provider.keys && provider.keys.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {provider.keys.map((k) => (
                  <span key={k.id} className="px-2 py-0.5 text-[11px] bg-surface-2 rounded">
                    {k.label}: {k.key_masked} {k.status !== 'unknown' && k.status !== 'live' && `(${k.status})`}
                  </span>
                ))}
              </div>
            )}
          </Field>
        )}
        {error && <p className="text-[13px] text-loss sm:col-span-2">{error}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save provider' : 'Create provider'}</Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        </div>
      </form>
    </Card>
  )
}

function ModelCatalog({
  provider,
  models,
  allProviders,
  onChanged,
}: {
  provider: UpstreamProvider
  models: UpstreamModel[]
  allProviders: UpstreamProvider[]
  onChanged: () => void | Promise<void>
}) {
  const [upstreamModel, setUpstreamModel] = useState('')
  const [contextWindow, setContextWindow] = useState('')
  const [maxOutput, setMaxOutput] = useState('')
  const [supportsStreaming, setSupportsStreaming] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importList, setImportList] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importError, setImportError] = useState('')

  const sameUrlProviders = allProviders.filter((p) => p.id !== provider.id && p.base_url === provider.base_url)

  async function fetchModels() {
    setImporting(true)
    setImportError('')
    setImportList([])
    setSelected(new Set())
    try {
      const data = await api.post<{ models: string[]; supported?: boolean }>(`/admin/upstream-providers/${provider.id}/fetch-models`)
      const list = data.models || []
      setImportList(list)
      setSelected(new Set()) // default none checked
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : 'Failed to fetch models')
    } finally {
      setImporting(false)
    }
  }

  async function addSelected() {
    setBusy(true)
    setImportError('')
    try {
      for (const name of Array.from(selected)) {
        try {
          await api.post('/admin/upstream-models', {
            upstream_provider_id: provider.id,
            upstream_model: name,
            capabilities: [],
            context_window: null,
            max_output_tokens: null,
            supports_streaming: true,
          })
        } catch {}
      }
      setImportList([])
      setSelected(new Set())
      await onChanged()
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : 'Failed to add models')
    } finally {
      setBusy(false)
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    const name = upstreamModel.trim()
    if (!name) {
      setError('Model name is required.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.post('/admin/upstream-models', {
        upstream_provider_id: provider.id,
        upstream_model: name,
        capabilities: [],
        context_window: contextWindow.trim() ? Number(contextWindow) : null,
        max_output_tokens: maxOutput.trim() ? Number(maxOutput) : null,
        supports_streaming: supportsStreaming,
      })
      setUpstreamModel('')
      setContextWindow('')
      setMaxOutput('')
      setSupportsStreaming(true)
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add model.')
    } finally {
      setBusy(false)
    }
  }

  async function setStreaming(model: UpstreamModel, enabled: boolean) {
    setBusy(true)
    setError('')
    try {
      await api.patch(`/admin/upstream-models/${provider.id}/${encodeURIComponent(model.upstream_model)}`, { supports_streaming: enabled })
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update streaming support.')
    } finally {
      setBusy(false)
    }
  }

  async function copyModelsFrom(sourceProvider: UpstreamProvider) {
    const sourceModels = models.filter((m) => m.upstream_provider_id === sourceProvider.id)
    if (sourceModels.length === 0) {
      setError(`No models to copy from "${sourceProvider.label}".`)
      return
    }
    if (!confirm(`Copy ${sourceModels.length} model(s) from "${sourceProvider.label}" to "${provider.label}"?`)) return
    setBusy(true)
    setError('')
    try {
      for (const m of sourceModels) {
        await api.post('/admin/upstream-models', {
          upstream_provider_id: provider.id,
          upstream_model: m.upstream_model,
          capabilities: m.capabilities,
          context_window: m.context_window,
          max_output_tokens: m.max_output_tokens,
          supports_streaming: m.supports_streaming,
        })
      }
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to copy models.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(model: UpstreamModel) {
    if (!confirm(`Remove "${model.upstream_model}" from this provider's catalog? Alias configs using it must be removed first.`)) return
    setBusy(true)
    setError('')
    try {
      await api.del(`/admin/upstream-models/${provider.id}/${encodeURIComponent(model.upstream_model)}`)
      await onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove model.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-wide text-muted">
          Upstream models — the exact names this provider accepts
        </p>
        <Button size="sm" variant="secondary" onClick={fetchModels} disabled={importing || busy}>
          {importing ? 'Fetching…' : 'Fetch models from /v1/models'}
        </Button>
      </div>
      {importError ? <p className="text-[13px] text-loss">{importError}</p> : null}
      {importList.length > 0 ? (
        <div className="flex flex-col gap-2 rounded border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-content">Select models to add (none checked by default)</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(importList))}>Select all</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>None</Button>
              <Button size="sm" onClick={addSelected} disabled={selected.size === 0 || busy}>{busy ? 'Adding…' : `Add ${selected.size} selected`}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setImportList([]); setSelected(new Set()) }}>Cancel</Button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto">
            <div className="flex flex-col gap-1">
              {importList.map((name) => (
                <label key={name} className="flex items-center gap-2 text-[13px] text-content">
                  <input type="checkbox" checked={selected.has(name)} onChange={(e) => {
                    const s = new Set(selected)
                    if (e.target.checked) s.add(name)
                    else s.delete(name)
                    setSelected(s)
                  }} />
                  <code className="font-mono text-[12px]">{name}</code>
                </label>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {models.length === 0 ? (
        <>
          {sameUrlProviders.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] text-muted">No models registered yet. Other providers with the same base URL have models — copy them:</p>
              <div className="flex flex-wrap gap-2">
                {sameUrlProviders.map((sp) => (
                  <Button key={sp.id} variant="secondary" size="sm" onClick={() => void copyModelsFrom(sp)} disabled={busy}>
                    Copy from {sp.label} ({models.filter((m) => m.upstream_provider_id === sp.id).length} models)
                  </Button>
                ))}
              </div>
              <p className="text-[13px] text-muted">Or add manually below:</p>
            </div>
          ) : <p className="text-[13px] text-muted">No models registered yet — add the first below.</p>}
        </>
      ) : (
        <div className="flex flex-col divide-y divide-line">
          {models.map((m) => (
            <div key={m.upstream_model} className="flex flex-wrap items-center gap-3 py-2">
              <code className="num rounded bg-surface-2 px-2 py-1 text-[12px]">{m.upstream_model}</code>
              {m.context_window != null && <span className="num text-[12px] text-muted">{m.context_window.toLocaleString('en-US')} ctx</span>}
              {m.max_output_tokens != null && <span className="num text-[12px] text-muted">{m.max_output_tokens.toLocaleString('en-US')} max out</span>}
              <label className="flex items-center gap-2 text-[12px] text-muted">
                <input type="checkbox" checked={m.supports_streaming !== 0} disabled={busy} onChange={(event) => void setStreaming(m, event.target.checked)} />
                Supports streaming
              </label>
              <Button variant="ghost" size="sm" className="ml-auto text-loss" onClick={() => void remove(m)} disabled={busy}>Remove</Button>
            </div>
          ))}
        </div>
      )}
      <form className="flex flex-wrap items-end gap-2" onSubmit={add}>
        <Field label="Model name"><input className="input num w-56" value={upstreamModel} onChange={(e) => setUpstreamModel(e.target.value)} placeholder="gemini-2.5-flash" /></Field>
        <Field label="Context window (optional)"><input className="input num w-32" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} inputMode="numeric" placeholder="128000" /></Field>
        <Field label="Max output (optional)"><input className="input num w-32" value={maxOutput} onChange={(e) => setMaxOutput(e.target.value)} inputMode="numeric" placeholder="32000" /></Field>
        <label className="flex items-center gap-2 py-2 text-[12px] text-muted"><input type="checkbox" checked={supportsStreaming} onChange={(event) => setSupportsStreaming(event.target.checked)} />Supports streaming</label>
        <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add model'}</Button>
      </form>
      {error && <p className="text-[12px] text-loss">{error}</p>}
    </div>
  )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  )
}
