// Admin API: the model catalog + user dashboard.
//
//   models           — aliases freellm_users chat with ("poolside-laguna")
//   upstream_providers — real upstream providers (Poolside, OpenAI, etc.)
//   upstream_models   — canonical model names per provider
//   model_providers   — alias -> upstream_provider + upstream_model mapping
//   users            — every signed-up user with balances + token leaderboard.
//
// Every route here is behind requireAuth + requireAdmin.

import { Hono } from 'hono'
import { requireAdmin, requireAuth } from '../lib/middleware'
import { decryptSecret, encryptSecret, maskSecret, newId } from '../lib/crypto'
import {
  EMAIL_BLOCK_MAX_RULES,
  validateEmailBlockPattern,
} from '../lib/email-blocks'
import { pingProvider } from '../lib/ping'
import { EWMA_ALPHA, EWMA_BETA } from '../lib/providers'
import {
  slugify,
  validateBaseUrl,
  validateBearer,
  validateCapabilities,
  validateUpstreamModel,
} from '../lib/validate'
import type { Bindings, ModelProviderRow, ModelRow, UpstreamProviderRow, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('/api/admin/*', requireAuth, requireAdmin)

const now = () => Date.now()

async function requireEncryptionKey(env: Bindings): Promise<string> {
  if (!env.ENCRYPTION_KEY) {
    throw new HttpError(500, 'not_configured', 'ENCRYPTION_KEY is not set. Run: openssl rand -base64 32 and add it to .dev.vars / wrangler secrets.')
  }
  return env.ENCRYPTION_KEY
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

// -------------------------------------------------------------- list models

app.get('/api/admin/models', async (c) => {
  const models = await c.env.DB.prepare('SELECT * FROM freellm_models ORDER BY sort_order, label').all<ModelRow>()
  
  // Join model_providers -> upstream_providers -> upstream_models
  const providerRows = await c.env.DB.prepare(
    `SELECT mp.*, up.id AS up_id, up.label AS up_label, up.base_url, up.api_key_ciphertext, up.api_key_iv,
            up.status AS up_status, up.avg_latency_ms, up.consecutive_failures, up.cooldown_until,
            up.cooldown_base_ms, up.last_checked_at, up.last_error,
            um.capabilities, um.context_window, um.max_output_tokens
     FROM freellm_model_providers mp
     JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     LEFT JOIN freellm_upstream_models um 
       ON um.upstream_provider_id = up.id AND um.upstream_model = mp.upstream_model
     WHERE mp.active = 1
     ORDER BY mp.model_id, mp.priority, mp.label`
  ).all<{
    id: string
    model_id: string
    upstream_provider_id: string
    upstream_model: string
    priority: number
    active: number
    messages_served: number
    created_at: number
    updated_at: number
    up_id: string
    up_label: string
    base_url: string
    api_key_ciphertext: string
    api_key_iv: string
    up_status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
    avg_latency_ms: number | null
    consecutive_failures: number
    cooldown_until: number | null
    cooldown_base_ms: number | null
    last_checked_at: number | null
    last_error: string | null
    capabilities: string | null
    context_window: number | null
    max_output_tokens: number | null
  }>()

  const byModel = new Map<string, typeof providerRows.results[0][]>()
  for (const p of providerRows.results) {
    const list = byModel.get(p.model_id) ?? []
    list.push(p)
    byModel.set(p.model_id, list)
  }

  const encryptionKey = c.env.ENCRYPTION_KEY
  const modelPayloads = await Promise.all(
    models.results.map(async (model) => ({
      ...model,
      capabilities: safeParseArray(model.capabilities),
      providers: await Promise.all(
        (byModel.get(model.id) ?? []).map(async (p) => ({
          id: p.id,
          label: p.up_label,
          upstream_provider_id: p.upstream_provider_id,
          upstream_model: p.upstream_model,
          upstream_model_caps: p.capabilities ? safeParseArray(p.capabilities) : [],
          upstream_model_context: p.context_window,
          upstream_model_max_output: p.max_output_tokens,
          base_url: p.base_url,
          key_masked: encryptionKey ? await safeKeyMask(p, encryptionKey) : '••••',
          status: p.active === 0 ? 'disabled' : p.up_status,
          last_checked_at: p.last_checked_at,
          last_error: p.last_error,
          avg_latency_ms: p.avg_latency_ms,
          priority: p.priority,
          active: p.active,
          messages_served: p.messages_served,
          cooldown_base_ms: p.cooldown_base_ms,
        })),
      ),
    })),
  )

  return c.json({ models: modelPayloads })
})

async function safeKeyMask(provider: {
  api_key_ciphertext: string
  api_key_iv: string
}, encryptionKey: string): Promise<string> {
  try {
    return maskSecret(await decryptSecret(provider.api_key_ciphertext, provider.api_key_iv, encryptionKey))
  } catch {
    return '•••• (key unreadable — check ENCRYPTION_KEY)'
  }
}

// ------------------------------------------------------- create alias (model)

app.post('/api/admin/models', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const label = String(body.label ?? '').trim()
  if (!label || label.length > 80) {
    return c.json({ error: 'invalid_input', message: 'Label is required (max 80 chars).' }, 400)
  }

  const slugInput = body.slug ? String(body.slug) : label
  const slug = slugify(slugInput)
  if (slug.length < 2) {
    return c.json({ error: 'invalid_input', message: 'Slug must contain at least 2 [a-z0-9] characters.' }, 400)
  }

  const capabilitiesError = validateCapabilities(body.capabilities)
  if (capabilitiesError) return c.json({ error: 'invalid_input', message: capabilitiesError }, 400)

  const flatRate = Number(body.flat_rate_credits ?? 2000)
  if (!Number.isInteger(flatRate) || flatRate < 0 || flatRate > 1_000_000) {
    return c.json({ error: 'invalid_input', message: 'Flat rate must be an integer 0–1,000,000 credits.' }, 400)
  }

  const routing = String(body.routing ?? 'round_robin')
  if (!['round_robin', 'random', 'failover', 'latency_weighted'].includes(routing)) {
    return c.json({ error: 'invalid_input', message: 'Routing must be round_robin, random, failover, or latency_weighted.' }, 400)
  }

  const accessTier = String(body.access_tier ?? 'free')
  if (!['free', 'pro', 'enterprise'].includes(accessTier)) {
    return c.json({ error: 'invalid_input', message: 'Access tier must be free, pro, or enterprise.' }, 400)
  }

  const contextWindow = body.context_window == null ? null : Number(body.context_window)
  if (contextWindow !== null && (!Number.isInteger(contextWindow) || contextWindow <= 0)) {
    return c.json({ error: 'invalid_input', message: 'Context window must be a positive integer.' }, 400)
  }

  const maxOutput = body.max_output_tokens == null ? 4096 : Number(body.max_output_tokens)
  if (!Number.isInteger(maxOutput) || maxOutput < 256 || maxOutput > 200_000) {
    return c.json({ error: 'invalid_input', message: 'Max output tokens must be an integer 256–200,000.' }, 400)
  }

  const id = newId()
  const timestamp = now()
  try {
    await c.env.DB.prepare(
      `INSERT INTO freellm_models (id, slug, label, description, capabilities, context_window, max_output_tokens, flat_rate_credits, routing, access_tier, scoped_only, active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
      .bind(
        id,
        slug,
        label,
        body.description ? String(body.description).slice(0, 500) : null,
        JSON.stringify(Array.isArray(body.capabilities) ? body.capabilities : []),
        contextWindow,
        maxOutput,
        flatRate,
        routing,
        accessTier,
        body.scoped_only ? 1 : 0,
        Number(body.sort_order ?? 0),
        timestamp,
        timestamp,
      )
      .run()
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_models.slug')) {
      return c.json({ error: 'slug_taken', message: 'That slug is already used by another alias.' }, 409)
    }
    throw err
  }

  const model = await c.env.DB.prepare('SELECT * FROM freellm_models WHERE id = ?').bind(id).first<ModelRow>()
  return c.json({ model: { ...model, capabilities: safeParseArray(model!.capabilities), providers: [] } }, 201)
})

// ------------------------------------------------------- update alias

app.patch('/api/admin/models/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT * FROM freellm_models WHERE id = ?').bind(id).first<ModelRow>()
  if (!existing) return c.json({ error: 'not_found', message: 'Model not found.' }, 404)

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const updates: Record<string, unknown> = {}

  if (body.label !== undefined) {
    const label = String(body.label).trim()
    if (!label || label.length > 80) return c.json({ error: 'invalid_input', message: 'Label must be 1–80 chars.' }, 400)
    updates.label = label
  }
  if (body.slug !== undefined) {
    const slug = slugify(String(body.slug))
    if (slug.length < 2) return c.json({ error: 'invalid_input', message: 'Slug must contain at least 2 [a-z0-9] characters.' }, 400)
    updates.slug = slug
  }
  if (body.description !== undefined) {
    const description = body.description == null ? '' : String(body.description).trim()
    updates.description = description ? description.slice(0, 500) : null
  }
  if (body.capabilities !== undefined) {
    const err = validateCapabilities(body.capabilities)
    if (err) return c.json({ error: 'invalid_input', message: err }, 400)
    updates.capabilities = JSON.stringify(body.capabilities)
  }
  if (body.flat_rate_credits !== undefined) {
    const flatRate = Number(body.flat_rate_credits)
    if (!Number.isInteger(flatRate) || flatRate < 0 || flatRate > 1_000_000) {
      return c.json({ error: 'invalid_input', message: 'Flat rate must be an integer 0–1,000,000 credits.' }, 400)
    }
    updates.flat_rate_credits = flatRate
  }
  if (body.routing !== undefined) {
    if (!['round_robin', 'random', 'failover', 'latency_weighted'].includes(String(body.routing))) {
      return c.json({ error: 'invalid_input', message: 'Routing must be round_robin, random, failover, or latency_weighted.' }, 400)
    }
    updates.routing = String(body.routing)
  }
  if (body.access_tier !== undefined) {
    if (!['free', 'pro', 'enterprise'].includes(String(body.access_tier))) {
      return c.json({ error: 'invalid_input', message: 'Access tier must be free, pro, or enterprise.' }, 400)
    }
    updates.access_tier = String(body.access_tier)
  }
  if (body.scoped_only !== undefined) {
    updates.scoped_only = body.scoped_only ? 1 : 0
  }
  if (body.context_window !== undefined) {
    const contextWindow = body.context_window == null ? null : Number(body.context_window)
    if (contextWindow !== null && (!Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return c.json({ error: 'invalid_input', message: 'Context window must be a positive integer or null.' }, 400)
    }
    updates.context_window = contextWindow
  }
  if (body.max_output_tokens !== undefined) {
    const maxOutput = Number(body.max_output_tokens)
    if (!Number.isInteger(maxOutput) || maxOutput < 256 || maxOutput > 200_000) {
      return c.json({ error: 'invalid_input', message: 'Max output tokens must be an integer 256–200,000.' }, 400)
    }
    updates.max_output_tokens = maxOutput
  }
  if (body.active !== undefined) updates.active = body.active ? 1 : 0
  if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order)

  const columns = Object.keys(updates)
  if (columns.length === 0) return c.json({ error: 'invalid_input', message: 'Nothing to update.' }, 400)

  updates.updated_at = now()
  const assignments = columns.map((column) => `${column} = ?`).join(', ')
  try {
    await c.env.DB.prepare(`UPDATE freellm_models SET ${assignments} WHERE id = ?`)
      .bind(...columns.map((column) => updates[column]), id)
      .run()
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_models.slug')) {
      return c.json({ error: 'slug_taken', message: 'That slug is already used by another alias.' }, 409)
    }
    throw err
  }

  const model = await c.env.DB.prepare('SELECT * FROM freellm_models WHERE id = ?').bind(id).first<ModelRow>()
  return c.json({ model: { ...model, capabilities: safeParseArray(model!.capabilities) } })
})

// ------------------------------------------------------- delete alias

app.delete('/api/admin/models/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM freellm_models WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'not_found', message: 'Model not found.' }, 404)
  // freellm_model_providers cascade via ON DELETE CASCADE
  await c.env.DB.prepare('DELETE FROM freellm_models WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ------------------------------------------------ list upstream providers

app.get('/api/admin/upstream-providers', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM freellm_upstream_providers ORDER BY label`
  ).all<UpstreamProviderRow>()

  const encryptionKey = c.env.ENCRYPTION_KEY
  const providers = await Promise.all(
    rows.results.map(async (p) => ({
      ...p,
      key_masked: await safeKeyMask(p, encryptionKey),
    }))
  )

  return c.json({ providers })
})

// ------------------------------------------------ create upstream provider

app.post('/api/admin/upstream-providers', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const label = String(body.label ?? '').trim()
  if (!label || label.length > 80) {
    return c.json({ error: 'invalid_input', message: 'Label is required (max 80 chars).' }, 400)
  }

  const allowHttp = c.env.ENVIRONMENT !== 'production'
  const urlError = validateBaseUrl(body.base_url, allowHttp)
  if (urlError) return c.json({ error: 'invalid_input', message: urlError }, 400)

  const keyError = validateBearer(body.api_key)
  if (keyError) return c.json({ error: 'invalid_input', message: keyError }, 400)

  const encryptionKey = await requireEncryptionKey(c.env)
  const { ciphertext, iv } = await encryptSecret(String(body.api_key).trim(), encryptionKey)

  let cooldownBaseMs: number | null = null
  if (body.cooldown_base_ms !== undefined && body.cooldown_base_ms !== null) {
    cooldownBaseMs = Number(body.cooldown_base_ms)
    if (!Number.isInteger(cooldownBaseMs) || cooldownBaseMs < 0 || cooldownBaseMs > 604800000) {
      return c.json({ error: 'invalid_input', message: 'Cooldown base must be an integer 0–604800000 ms (7 days), or null for the default.' }, 400)
    }
  }

  const id = newId()
  const timestamp = now()
  await c.env.DB.prepare(
    `INSERT INTO freellm_upstream_providers (id, label, base_url, api_key_ciphertext, api_key_iv, status, cooldown_base_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'unknown', ?, ?, ?)`,
  )
    .bind(
      id,
      label,
      String(body.base_url).trim().replace(/\/+$/, ''),
      ciphertext,
      iv,
      cooldownBaseMs,
      timestamp,
      timestamp,
    )
    .run()

  const provider = await c.env.DB.prepare('SELECT * FROM freellm_upstream_providers WHERE id = ?').bind(id).first<UpstreamProviderRow>()
  return c.json({ provider: { ...provider!, key_masked: await safeKeyMask(provider!, encryptionKey) } }, 201)
})

// ------------------------------------------------ update upstream provider

app.patch('/api/admin/upstream-providers/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT * FROM freellm_upstream_providers WHERE id = ?').bind(id).first<UpstreamProviderRow>()
  if (!existing) return c.json({ error: 'not_found', message: 'Upstream provider not found.' }, 404)

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const updates: Record<string, unknown> = {}
  const allowHttp = c.env.ENVIRONMENT !== 'production'

  if (body.label !== undefined) {
    const label = String(body.label).trim()
    if (!label || label.length > 80) return c.json({ error: 'invalid_input', message: 'Label must be 1–80 chars.' }, 400)
    updates.label = label
  }
  if (body.base_url !== undefined) {
    const urlError = validateBaseUrl(body.base_url, allowHttp)
    if (urlError) return c.json({ error: 'invalid_input', message: urlError }, 400)
    updates.base_url = String(body.base_url).trim().replace(/\/+$/, '')
  }
  if (body.cooldown_base_ms !== undefined) {
    if (body.cooldown_base_ms === null) {
      updates.cooldown_base_ms = null
    } else {
      const cooldownBaseMs = Number(body.cooldown_base_ms)
      if (!Number.isInteger(cooldownBaseMs) || cooldownBaseMs < 0 || cooldownBaseMs > 604800000) {
        return c.json({ error: 'invalid_input', message: 'Cooldown base must be an integer 0–604800000 ms (7 days), or null for the default.' }, 400)
      }
      updates.cooldown_base_ms = cooldownBaseMs
    }
  }
  if (body.active !== undefined) updates.active = body.active ? 1 : 0
  if (body.api_key !== undefined && body.api_key !== null && String(body.api_key) !== '') {
    const keyError = validateBearer(body.api_key)
    if (keyError) return c.json({ error: 'invalid_input', message: keyError }, 400)
    const encryptionKey = await requireEncryptionKey(c.env)
    const { ciphertext, iv } = await encryptSecret(String(body.api_key).trim(), encryptionKey)
    updates.api_key_ciphertext = ciphertext
    updates.api_key_iv = iv
    // force a re-test after key rotation
    updates.status = 'unknown'
    updates.last_error = null
    updates.consecutive_failures = 0
    updates.cooldown_until = null
  }

  const columns = Object.keys(updates)
  if (columns.length === 0) return c.json({ error: 'invalid_input', message: 'Nothing to update.' }, 400)

  updates.updated_at = now()
  const assignments = columns.map((column) => `${column} = ?`).join(', ')
  await c.env.DB.prepare(`UPDATE freellm_upstream_providers SET ${assignments} WHERE id = ?`)
    .bind(...columns.map((column) => updates[column]), id)
    .run()

  const provider = await c.env.DB.prepare('SELECT * FROM freellm_upstream_providers WHERE id = ?').bind(id).first<UpstreamProviderRow>()
  return c.json({ provider: { ...provider!, key_masked: await safeKeyMask(provider!, await requireEncryptionKey(c.env)) } })
})

// ------------------------------------------------ delete upstream provider

app.delete('/api/admin/upstream-providers/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM freellm_upstream_providers WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'not_found', message: 'Upstream provider not found.' }, 404)
  
  // Check if any model_providers reference this upstream provider
  const refs = await c.env.DB.prepare('SELECT 1 FROM freellm_model_providers WHERE upstream_provider_id = ? LIMIT 1').bind(id).first()
  if (refs) return c.json({ error: 'in_use', message: 'Cannot delete — provider is referenced by model configs.' }, 409)

  await c.env.DB.prepare('DELETE FROM freellm_upstream_providers WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ------------------------------------------------ test upstream provider

app.post('/api/admin/upstream-providers/:id/test', async (c) => {
  const id = c.req.param('id')
  const provider = await c.env.DB.prepare('SELECT * FROM freellm_upstream_providers WHERE id = ?').bind(id).first<UpstreamProviderRow>()
  if (!provider) return c.json({ error: 'not_found', message: 'Upstream provider not found.' }, 404)

  const encryptionKey = await requireEncryptionKey(c.env)
  const apiKey = await decryptSecret(provider.api_key_ciphertext, provider.api_key_iv, encryptionKey)
  const result = await pingProvider(provider.base_url, 'test', apiKey)

  const timestamp = now()
  // Same EWMA as pool configs — a single probe must not wipe stream history.
  await c.env.DB.prepare(
    `UPDATE freellm_upstream_providers
     SET status = ?, last_checked_at = ?, last_error = ?,
         avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN ?
                               ELSE CAST(avg_latency_ms * ? + ? * ? AS INTEGER) END,
         consecutive_failures = ?, cooldown_until = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      result.status,
      timestamp,
      result.error ?? null,
      result.latencyMs,
      EWMA_BETA,
      result.latencyMs,
      EWMA_ALPHA,
      result.ok ? 0 : provider.consecutive_failures + 1,
      timestamp,
      id,
    )
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM freellm_upstream_providers WHERE id = ?').bind(id).first<UpstreamProviderRow>()
  return c.json({ provider: { ...updated!, key_masked: await safeKeyMask(updated!, encryptionKey) }, test: result })
})

// ------------------------------------------------ reveal upstream provider key

app.post('/api/admin/upstream-providers/:id/reveal', async (c) => {
  const id = c.req.param('id')
  const provider = await c.env.DB.prepare('SELECT * FROM freellm_upstream_providers WHERE id = ?').bind(id).first<UpstreamProviderRow>()
  if (!provider) return c.json({ error: 'not_found', message: 'Upstream provider not found.' }, 404)

  const encryptionKey = await requireEncryptionKey(c.env)
  const apiKey = await decryptSecret(provider.api_key_ciphertext, provider.api_key_iv, encryptionKey)
  return c.json({ id: provider.id, label: provider.label, api_key: apiKey })
})

// ------------------------------------------------ model providers (alias -> upstream provider + model)

// List model providers for an alias
app.get('/api/admin/models/:id/providers', async (c) => {
  const modelId = c.req.param('id')
  const model = await c.env.DB.prepare('SELECT id FROM freellm_models WHERE id = ?').bind(modelId).first()
  if (!model) return c.json({ error: 'not_found', message: 'Model not found.' }, 404)

  const rows = await c.env.DB.prepare(
    `SELECT mp.*, up.id AS up_id, up.label AS up_label, up.base_url, up.api_key_ciphertext, up.api_key_iv,
            up.status AS up_status, up.avg_latency_ms, up.consecutive_failures, up.cooldown_until,
            up.cooldown_base_ms, up.last_checked_at, up.last_error,
            um.capabilities, um.context_window, um.max_output_tokens
     FROM freellm_model_providers mp
     JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     LEFT JOIN freellm_upstream_models um 
       ON um.upstream_provider_id = up.id AND um.upstream_model = mp.upstream_model
     WHERE mp.model_id = ? AND mp.active = 1
     ORDER BY mp.priority, mp.label`
  ).all<{
    id: string
    model_id: string
    upstream_provider_id: string
    upstream_model: string
    priority: number
    active: number
    messages_served: number
    created_at: number
    updated_at: number
    up_id: string
    up_label: string
    base_url: string
    api_key_ciphertext: string
    api_key_iv: string
    up_status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
    avg_latency_ms: number | null
    consecutive_failures: number
    cooldown_until: number | null
    cooldown_base_ms: number | null
    last_checked_at: number | null
    last_error: string | null
    capabilities: string | null
    context_window: number | null
    max_output_tokens: number | null
  }>()

  const encryptionKey = c.env.ENCRYPTION_KEY
  const providers = await Promise.all(
    rows.results.map(async (p) => ({
      id: p.id,
      label: p.up_label,
      upstream_provider_id: p.upstream_provider_id,
      upstream_model: p.upstream_model,
      upstream_model_caps: p.capabilities ? safeParseArray(p.capabilities) : [],
      upstream_model_context: p.context_window,
      upstream_model_max_output: p.max_output_tokens,
      base_url: p.base_url,
      key_masked: await safeKeyMask(p, encryptionKey),
      status: p.active === 0 ? 'disabled' : p.up_status,
      last_checked_at: p.last_checked_at,
      last_error: p.last_error,
      avg_latency_ms: p.avg_latency_ms,
      priority: p.priority,
      active: p.active,
      messages_served: p.messages_served,
      cooldown_base_ms: p.cooldown_base_ms,
    }))
  )

  return c.json({ providers })
})

// Add model provider (link alias to upstream provider + model)
app.post('/api/admin/models/:id/providers', async (c) => {
  const modelId = c.req.param('id')
  const model = await c.env.DB.prepare('SELECT id FROM freellm_models WHERE id = ?').bind(modelId).first()
  if (!model) return c.json({ error: 'not_found', message: 'Model not found.' }, 404)

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  // Validate upstream provider exists
  const upstreamProviderId = String(body.upstream_provider_id ?? '').trim()
  if (!upstreamProviderId) return c.json({ error: 'invalid_input', message: 'upstream_provider_id is required.' }, 400)
  
  const upstreamProvider = await c.env.DB.prepare('SELECT id FROM freellm_upstream_providers WHERE id = ? AND active = 1').bind(upstreamProviderId).first()
  if (!upstreamProvider) return c.json({ error: 'invalid_input', message: 'Upstream provider not found or inactive.' }, 400)

  // Validate upstream_model exists for this provider
  const upstreamModel = String(body.upstream_model ?? '').trim()
  if (!upstreamModel) return c.json({ error: 'invalid_input', message: 'upstream_model is required.' }, 400)
  
  const upstreamModelRow = await c.env.DB.prepare(
    'SELECT * FROM freellm_upstream_models WHERE upstream_provider_id = ? AND upstream_model = ?'
  ).bind(upstreamProviderId, upstreamModel).first()
  if (!upstreamModelRow) return c.json({ error: 'invalid_input', message: 'Unknown upstream_model for this provider.' }, 400)

  const id = newId()
  const timestamp = now()
  await c.env.DB.prepare(
    `INSERT INTO freellm_model_providers (id, model_id, upstream_provider_id, upstream_model, priority, active, messages_served, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(id, modelId, upstreamProviderId, upstreamModel, Number(body.priority ?? 0), timestamp, timestamp)
    .run()

  const provider = await c.env.DB.prepare(
    `SELECT mp.*, up.label AS up_label, up.base_url, up.api_key_ciphertext, up.api_key_iv,
            up.status AS up_status, up.avg_latency_ms, up.consecutive_failures, up.cooldown_until,
            up.cooldown_base_ms, up.last_checked_at, up.last_error
     FROM freellm_model_providers mp
     JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     WHERE mp.id = ?`
  ).bind(id).first()

  const encryptionKey = c.env.ENCRYPTION_KEY
  return c.json({ provider: await publicModelProvider(provider!, encryptionKey) }, 201)
})

// Update model provider
app.patch('/api/admin/models/:id/providers/:providerId', async (c) => {
  const modelId = c.req.param('id')
  const providerId = c.req.param('providerId')
  const existing = await c.env.DB.prepare('SELECT * FROM freellm_model_providers WHERE id = ? AND model_id = ?')
    .bind(providerId, modelId)
    .first<ModelProviderRow>()
  if (!existing) return c.json({ error: 'not_found', message: 'Provider config not found.' }, 404)

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const updates: Record<string, unknown> = {}

  if (body.priority !== undefined) {
    const priority = Number(body.priority)
    if (!Number.isInteger(priority)) return c.json({ error: 'invalid_input', message: 'Priority must be an integer.' }, 400)
    updates.priority = priority
  }
  if (body.active !== undefined) updates.active = body.active ? 1 : 0
  if (body.upstream_model !== undefined) {
    const upstreamModel = String(body.upstream_model).trim()
    // Validate it exists for the upstream provider
    const upstreamModelRow = await c.env.DB.prepare(
      'SELECT * FROM freellm_upstream_models WHERE upstream_provider_id = ? AND upstream_model = ?'
    ).bind(existing.upstream_provider_id, upstreamModel).first()
    if (!upstreamModelRow) return c.json({ error: 'invalid_input', message: 'Unknown upstream_model for this provider.' }, 400)
    updates.upstream_model = upstreamModel
  }
  if (body.upstream_provider_id !== undefined) {
    const upstreamProviderId = String(body.upstream_provider_id).trim()
    const upstreamProvider = await c.env.DB.prepare('SELECT id FROM freellm_upstream_providers WHERE id = ? AND active = 1').bind(upstreamProviderId).first()
    if (!upstreamProvider) return c.json({ error: 'invalid_input', message: 'Upstream provider not found or inactive.' }, 400)
    updates.upstream_provider_id = upstreamProviderId
  }

  const columns = Object.keys(updates)
  if (columns.length === 0) return c.json({ error: 'invalid_input', message: 'Nothing to update.' }, 400)

  updates.updated_at = now()
  const assignments = columns.map((column) => `${column} = ?`).join(', ')
  await c.env.DB.prepare(`UPDATE freellm_model_providers SET ${assignments} WHERE id = ?`)
    .bind(...columns.map((column) => updates[column]), providerId)
    .run()

  const provider = await c.env.DB.prepare(
    `SELECT mp.*, up.label AS up_label, up.base_url, up.api_key_ciphertext, up.api_key_iv,
            up.status AS up_status, up.avg_latency_ms, up.consecutive_failures, up.cooldown_until,
            up.cooldown_base_ms, up.last_checked_at, up.last_error
     FROM freellm_model_providers mp
     JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     WHERE mp.id = ?`
  ).bind(providerId).first()

  const encryptionKey = c.env.ENCRYPTION_KEY
  return c.json({ provider: await publicModelProvider(provider!, encryptionKey) })
})

// Delete model provider
app.delete('/api/admin/models/:id/providers/:providerId', async (c) => {
  const modelId = c.req.param('id')
  const providerId = c.req.param('providerId')
  const existing = await c.env.DB.prepare('SELECT id FROM freellm_model_providers WHERE id = ? AND model_id = ?')
    .bind(providerId, modelId)
    .first()
  if (!existing) return c.json({ error: 'not_found', message: 'Provider config not found.' }, 404)
  await c.env.DB.prepare('DELETE FROM freellm_model_providers WHERE id = ?').bind(providerId).run()
  return c.json({ ok: true })
})

// Test model provider (uses upstream provider's credentials)
app.post('/api/admin/models/:id/providers/:providerId/test', async (c) => {
  const modelId = c.req.param('id')
  const providerId = c.req.param('providerId')
  const provider = await c.env.DB.prepare(
    `SELECT mp.*, up.base_url, up.api_key_ciphertext, up.api_key_iv, up.status AS up_status
     FROM freellm_model_providers mp
     JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     WHERE mp.id = ? AND mp.model_id = ?`
  ).bind(providerId, modelId).first()

  if (!provider) return c.json({ error: 'not_found', message: 'Provider config not found.' }, 404)

  const encryptionKey = await requireEncryptionKey(c.env)
  const apiKey = await decryptSecret(provider.api_key_ciphertext, provider.api_key_iv, encryptionKey)
  const result = await pingProvider(provider.base_url, provider.upstream_model, apiKey)

  const timestamp = now()
  // Update upstream provider health (shared)
  await c.env.DB.prepare(
    `UPDATE freellm_upstream_providers
     SET status = ?, last_checked_at = ?, last_error = ?,
         avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN ?
                               ELSE CAST(avg_latency_ms * ? + ? * ? AS INTEGER) END,
         consecutive_failures = ?, cooldown_until = NULL, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      result.status,
      timestamp,
      result.error ?? null,
      result.latencyMs,
      EWMA_BETA,
      result.latencyMs,
      EWMA_ALPHA,
      result.ok ? 0 : provider.consecutive_failures + 1,
      timestamp,
      provider.upstream_provider_id,
    )
    .run()

  // Also update model_provider messages_served on success
  if (result.ok) {
    await c.env.DB.prepare(
      'UPDATE freellm_model_providers SET messages_served = messages_served + 1, updated_at = ? WHERE id = ?'
    ).bind(timestamp, providerId).run()
  }

  const updated = await c.env.DB.prepare(
    `SELECT mp.*, up.label AS up_label, up.base_url, up.api_key_ciphertext, up.api_key_iv,
            up.status AS up_status, up.avg_latency_ms, up.consecutive_failures, up.cooldown_until,
            up.cooldown_base_ms, up.last_checked_at, up.last_error
     FROM freellm_model_providers mp
     JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     WHERE mp.id = ?`
  ).bind(providerId).first()

  return c.json({ provider: await publicModelProvider(updated!, encryptionKey), test: result })
})

// Reveal model provider key (actually reveals upstream provider key)
app.post('/api/admin/models/:id/providers/:providerId/reveal', async (c) => {
  const modelId = c.req.param('id')
  const providerId = c.req.param('providerId')
  const provider = await c.env.DB.prepare(
    `SELECT mp.*, up.api_key_ciphertext, up.api_key_iv
     FROM freellm_model_providers mp
     JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     WHERE mp.id = ? AND mp.model_id = ?`
  ).bind(providerId, modelId).first()

  if (!provider) return c.json({ error: 'not_found', message: 'Provider config not found.' }, 404)

  const encryptionKey = await requireEncryptionKey(c.env)
  const apiKey = await decryptSecret(provider.api_key_ciphertext, provider.api_key_iv, encryptionKey)
  return c.json({ id: provider.id, label: provider.up_label, api_key: apiKey })
})

async function publicModelProvider(provider: {
  id: string
  model_id: string
  upstream_provider_id: string
  upstream_model: string
  priority: number
  active: number
  messages_served: number
  created_at: number
  updated_at: number
  up_label: string
  base_url: string
  api_key_ciphertext: string
  api_key_iv: string
  up_status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
  avg_latency_ms: number | null
  consecutive_failures: number
  cooldown_until: number | null
  cooldown_base_ms: number | null
  last_checked_at: number | null
  last_error: string | null
}, encryptionKey: string) {
  return {
    id: provider.id,
    label: provider.up_label,
    upstream_provider_id: provider.upstream_provider_id,
    upstream_model: provider.upstream_model,
    base_url: provider.base_url,
    key_masked: await safeKeyMask(provider, encryptionKey),
    status: provider.active === 0 ? 'disabled' : provider.up_status,
    last_checked_at: provider.last_checked_at,
    last_error: provider.last_error,
    avg_latency_ms: provider.avg_latency_ms,
    priority: provider.priority,
    active: provider.active,
    messages_served: provider.messages_served,
    cooldown_base_ms: provider.cooldown_base_ms,
  }
}

// ------------------------------------------------ upstream models catalog

app.get('/api/admin/upstream-models', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT um.*, up.label AS provider_label
     FROM freellm_upstream_models um
     JOIN freellm_upstream_providers up ON up.id = um.upstream_provider_id
     ORDER BY up.label, um.upstream_model`
  ).all<{
    upstream_provider_id: string
    upstream_model: string
    capabilities: string | null
    context_window: number | null
    max_output_tokens: number | null
    provider_label: string
  }>()

  return c.json({ models: rows.results })
})

app.post('/api/admin/upstream-models', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const upstreamProviderId = String(body.upstream_provider_id ?? '').trim()
  const upstreamModel = String(body.upstream_model ?? '').trim()
  if (!upstreamProviderId || !upstreamModel) {
    return c.json({ error: 'invalid_input', message: 'upstream_provider_id and upstream_model are required.' }, 400)
  }

  const provider = await c.env.DB.prepare('SELECT id FROM freellm_upstream_providers WHERE id = ? AND active = 1').bind(upstreamProviderId).first()
  if (!provider) return c.json({ error: 'invalid_input', message: 'Upstream provider not found or inactive.' }, 400)

  const capabilities = Array.isArray(body.capabilities) ? body.capabilities : []
  const contextWindow = body.context_window == null ? null : Number(body.context_window)
  const maxOutputTokens = body.max_output_tokens == null ? null : Number(body.max_output_tokens)

  const timestamp = now()
  try {
    await c.env.DB.prepare(
      `INSERT INTO freellm_upstream_models (upstream_provider_id, upstream_model, capabilities, context_window, max_output_tokens)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(upstreamProviderId, upstreamModel, JSON.stringify(capabilities), contextWindow, maxOutputTokens).run()
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'already_exists', message: 'This model is already registered for this provider.' }, 409)
    }
    throw err
  }

  return c.json({ ok: true }, 201)
})

app.delete('/api/admin/upstream-models/:providerId/:modelName', async (c) => {
  const upstreamProviderId = c.req.param('providerId')
  const upstreamModel = decodeURIComponent(c.req.param('modelName'))
  const existing = await c.env.DB.prepare(
    'SELECT 1 FROM freellm_upstream_models WHERE upstream_provider_id = ? AND upstream_model = ?'
  ).bind(upstreamProviderId, upstreamModel).first()
  if (!existing) return c.json({ error: 'not_found', message: 'Upstream model not found.' }, 404)

  // Check if any model_providers reference this
  const refs = await c.env.DB.prepare(
    'SELECT 1 FROM freellm_model_providers WHERE upstream_provider_id = ? AND upstream_model = ? LIMIT 1'
  ).bind(upstreamProviderId, upstreamModel).first()
  if (refs) return c.json({ error: 'in_use', message: 'Cannot delete — model is referenced by model configs.' }, 409)

  await c.env.DB.prepare(
    'DELETE FROM freellm_upstream_models WHERE upstream_provider_id = ? AND upstream_model = ?'
  ).bind(upstreamProviderId, upstreamModel).run()

  return c.json({ ok: true })
})

// ------------------------------------------------------------- user board
// Every signed-up user with balances, ranked by token balance. Spent comes
// from usage events (the full picture incl. scoped grants); earned from
// positive ledger deltas. Password hashes never leave the server.

app.get('/api/admin/users', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200), 1), 500)
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.tier, u.role, u.balance_credits,
            u.email_verified, u.referral_code, u.created_at,
            COALESCE((SELECT SUM(e.credits_charged) FROM freellm_usage_events e
                      WHERE e.user_id = u.id AND e.status != 'failed'), 0) AS spent,
            COALESCE((SELECT SUM(l.delta) FROM freellm_credit_ledger l
                      WHERE l.user_id = u.id AND l.delta > 0), 0) AS earned
     FROM freellm_users u
     ORDER BY u.balance_credits DESC
     LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: string
      email: string
      username: string
      tier: string
      role: string
      balance_credits: number
      email_verified: number
      referral_code: string
      created_at: number
      spent: number
      earned: number
    }>()
  return c.json({ users: rows.results })
})

app.patch('/api/admin/users/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM freellm_users WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'not_found', message: 'User not found.' }, 404)

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)
  if (body.tier === undefined) return c.json({ error: 'invalid_input', message: 'Nothing to update.' }, 400)
  if (!['free', 'pro', 'enterprise'].includes(String(body.tier))) {
    return c.json({ error: 'invalid_input', message: 'Tier must be free, pro, or enterprise.' }, 400)
  }

  const timestamp = now()
  await c.env.DB.prepare('UPDATE freellm_users SET tier = ?, updated_at = ? WHERE id = ?')
    .bind(String(body.tier), timestamp, id)
    .run()
  const user = await c.env.DB.prepare(
    'SELECT id, email, username, tier, role, balance_credits, email_verified, referral_code, created_at FROM freellm_users WHERE id = ?',
  )
    .bind(id)
    .first()
  return c.json({ user })
})

// ---------------------------------------------------------- email blocks
// Admin-managed sign-up blocklist: regexes tested against the normalized
// email at Google-OAuth time. A match rejects the sign-in outright.

app.get('/api/admin/email-blocks', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, pattern, created_by, created_at FROM freellm_email_blocks ORDER BY created_at DESC',
  ).all<{ id: string; pattern: string; created_by: string | null; created_at: number }>()
  return c.json({ blocks: rows.results })
})

app.post('/api/admin/email-blocks', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  const pattern = typeof body?.pattern === 'string' ? body.pattern.trim() : ''
  const invalid = validateEmailBlockPattern(pattern)
  if (invalid) return c.json({ error: 'invalid_input', message: invalid }, 400)

  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM freellm_email_blocks')
    .first<{ n: number }>()
  if ((count?.n ?? 0) >= EMAIL_BLOCK_MAX_RULES) {
    return c.json({ error: 'limit_reached', message: `At most ${EMAIL_BLOCK_MAX_RULES} block rules — delete one first.` }, 409)
  }

  const me = c.get('user')
  const id = newId()
  const timestamp = now()
  try {
    await c.env.DB.prepare(
      'INSERT INTO freellm_email_blocks (id, pattern, created_by, created_at) VALUES (?, ?, ?, ?)',
    )
      .bind(id, pattern, me?.id ?? null, timestamp)
      .run()
  } catch {
    return c.json({ error: 'duplicate', message: 'That pattern is already blocked.' }, 409)
  }
  return c.json({ block: { id, pattern, created_by: me?.id ?? null, created_at: timestamp } }, 201)
})

app.delete('/api/admin/email-blocks/:id', async (c) => {
  const id = c.req.param('id')
  const result = (await c.env.DB.prepare('DELETE FROM freellm_email_blocks WHERE id = ?')
    .bind(id)
    .run() as unknown as { meta?: { changes?: number } })
  if (result?.meta?.changes === 0) {
    return c.json({ error: 'not_found', message: 'Block rule not found.' }, 404)
  }
  return c.json({ ok: true })
})

export default app