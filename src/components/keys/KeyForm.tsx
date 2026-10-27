import { useState, type FormEvent, type ChangeEvent } from 'react'
import { Button, Input } from '../../components/ui'
import type { ByokKey, KeyTestResult } from '../../pages/Keys'
import { api, ApiError } from '../../lib/api'

type Protocol = 'openai' | 'codex'

interface KeyFormProps {
  onAddKey: (key: ByokKey, test: KeyTestResult) => void
  onError: (message: string) => void
  onSuccess: (message: string) => void
  isAdding: boolean
  setIsAdding: (adding: boolean) => void
}

const emptyForm = {
  label: '',
  base_url: '',
  upstream_model: '',
  api_key: '',
  protocol: 'openai' as Protocol,
}

export function KeyForm({
  onAddKey,
  onError,
  onSuccess,
  isAdding,
  setIsAdding,
}: KeyFormProps) {
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkKeys, setBulkKeys] = useState('')

  const validateForm = () => {
    const e: Record<string, string> = {}
    if (!form.label.trim() || form.label.length > 80) e.label = 'Label (1–80 chars) is required.'
    if (form.protocol === 'codex') {
      if (form.base_url.trim() !== '') {
        try { new URL(form.base_url) } catch { e.base_url = 'Enter a valid base URL or leave empty for the default Codex endpoint.' }
      }
    } else {
      try { new URL(form.base_url) } catch { e.base_url = 'Enter a valid base URL (e.g. https://api.openai.com/v1).' }
    }
    if (!form.upstream_model.trim()) e.upstream_model = form.protocol === 'codex' ? 'Upstream model name is required (e.g. gpt-5.5).' : 'Upstream model name is required (e.g. gpt-4o).'
    if (!form.api_key.trim()) e.api_key = 'Paste your provider API key.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!validateForm()) return
    setIsAdding(true)
    onError('')
    try {
      const res = await api.post<{ key: ByokKey; test: KeyTestResult }>('/keys', {
        label: form.label.trim(),
        ...(form.base_url.trim() !== '' ? { base_url: form.base_url.trim() } : {}),
        upstream_model: form.upstream_model.trim(),
        api_key: form.api_key.trim(),
        auth_kind: 'api_key',
        protocol: form.protocol,
      })
      setForm(emptyForm)
      onAddKey(res.key, res.test)
      if (res.test.ok) {
        onSuccess('Key added and validated ✓')
      } else {
        onSuccess(`Key added but validation failed: ${res.test.error}. Test again before using.`)
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      onError(`Add failed: ${msg}. Need help? Contact help@freellm.hasit.in`)
    } finally {
      setIsAdding(false)
    }
  }

  const handleBulkAdd = async () => {
    setIsAdding(true)
    onError('')
    try {
      const keysData = JSON.parse(bulkKeys)
      if (!Array.isArray(keysData)) {
        throw new Error('Expected a JSON array')
      }
      const res = await api.post<{ keys: Array<{ key: ByokKey; test: KeyTestResult }> }>('/keys', keysData)
      setBulkKeys('')
      setBulkMode(false)
      res.keys.forEach(({ key, test }) => onAddKey(key, test))
      const allOk = res.keys.every(r => r.test.ok)
      if (allOk) {
        onSuccess(`${res.keys.length} keys imported and validated ✓`)
      } else {
        const failed = res.keys.filter(r => !r.test.ok).length
        onSuccess(`${res.keys.length} keys imported, ${failed} failed validation. Test them before using.`)
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      onError(`Bulk import failed: ${msg}. Need help? Contact help@freellm.hasit.in`)
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-[12px] font-medium mb-1">Account type</label>
        <div className="flex gap-2" role="radiogroup" aria-label="Account type">
          {(['openai', 'codex'] as const).map((protocol) => (
            <button
              key={protocol}
              type="button"
              role="radio"
              aria-checked={form.protocol === protocol}
              onClick={() => setForm({ ...form, protocol })}
              className={`rounded border px-3 py-2 text-[12px] min-h-[44px] ${form.protocol === protocol ? 'border-accent bg-accent/10 text-content' : 'border-line text-muted'}`}
            >
              {protocol === 'openai' ? 'OpenAI-compatible' : 'Codex (ChatGPT)'}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-muted">
          {form.protocol === 'codex'
            ? 'Your own ChatGPT Codex account, dialled through the Responses API. Prefer Connect above — manual entry needs a pasted token.'
            : 'Any OpenAI-compatible endpoint with a static bearer key.'}
        </p>
      </div>
      <div>
        <label className="block text-[12px] font-medium mb-1">Label</label>
        <Input
          value={form.label}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, label: e.target.value })}
          placeholder="e.g. My OpenAI, Team Anthropic proxy"
          className={errors.label ? 'border-loss' : ''}
        />
        {errors.label && <p className="mt-1 text-[12px] text-loss">{errors.label}</p>}
      </div>
      <div>
        <label className="block text-[12px] font-medium mb-1">Base URL{form.protocol === 'codex' ? ' (optional)' : ''}</label>
        <Input
          value={form.base_url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, base_url: e.target.value })}
          placeholder={form.protocol === 'codex' ? 'empty = default ChatGPT Codex endpoint' : 'https://api.openai.com/v1'}
          className={errors.base_url ? 'border-loss' : ''}
        />
        {errors.base_url && <p className="mt-1 text-[12px] text-loss">{errors.base_url}</p>}
      </div>
      {form.protocol === 'codex' && (
        <p className="text-[12px] text-warn">
          Codex accounts need a ChatGPT OAuth token — use Connect above instead of pasting here.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-[12px] font-medium mb-1">Upstream Model</label>
          <Input
            value={form.upstream_model}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, upstream_model: e.target.value })}
            placeholder={form.protocol === 'codex' ? 'gpt-5.5' : 'gpt-4o'}
            className={errors.upstream_model ? 'border-loss' : ''}
          />
          {errors.upstream_model && <p className="mt-1 text-[12px] text-loss">{errors.upstream_model}</p>}
        </div>
        <div>
          <label className="block text-[12px] font-medium mb-1">API Key</label>
          <Input
            type="password"
            value={form.api_key}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, api_key: e.target.value })}
            placeholder="sk-…"
            className={errors.api_key ? 'border-loss' : ''}
          />
          {errors.api_key && <p className="mt-1 text-[12px] text-loss">{errors.api_key}</p>}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 justify-end">
        <Button type="button" variant="secondary" onClick={() => setForm(emptyForm)} className="min-h-[44px]">
          Clear
        </Button>
        <Button type="button" variant="secondary" onClick={() => setBulkMode(!bulkMode)} className="min-h-[44px]">
          {bulkMode ? 'Single key' : 'Bulk import (paste JSON array)'}
        </Button>
        <Button type="submit" disabled={isAdding} className="min-h-[44px]">
          {isAdding ? 'Validating…' : 'Add & validate'}
        </Button>
      </div>

      {bulkMode && (
        <div className="border-t border-line pt-4 space-y-4">
          <p className="text-[13px] text-muted">
            Paste a JSON array of key objects. Each object should have: label, base_url, upstream_model, api_key, auth_kind ('api_key' or 'oauth'), protocol ('openai' or 'codex'), and optional fields: account_id, refresh_token, expires_at.
          </p>
          <textarea
            value={bulkKeys}
            onChange={(e) => setBulkKeys(e.target.value)}
            placeholder='[
  {
    "label": "My OpenAI",
    "base_url": "https://api.openai.com/v1",
    "upstream_model": "gpt-4o",
    "api_key": "sk-...",
    "auth_kind": "api_key",
    "protocol": "openai"
  },
  {
    "label": "Team Anthropic",
    "base_url": "https://api.anthropic.com/v1",
    "upstream_model": "claude-3-opus",
    "api_key": "sk-ant-...",
    "auth_kind": "api_key",
    "protocol": "openai"
  }
]'
            className="w-full h-64 font-mono text-[12px] p-3 rounded border border-line bg-surface min-h-[44px]"
          />
          <div className="flex flex-col sm:flex-row gap-2 justify-end">
            <Button type="button" variant="secondary" onClick={() => { setBulkMode(false); setBulkKeys('') }} className="min-h-[44px]">
              Cancel
            </Button>
            <Button type="button" onClick={handleBulkAdd} disabled={isAdding || !bulkKeys.trim()} className="min-h-[44px]">
              {isAdding ? 'Validating…' : 'Import keys'}
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
