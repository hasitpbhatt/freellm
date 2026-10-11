// Admin API: the model catalog + user dashboard.
//
//   models           — aliases freellm_users chat with ("poolside-laguna")
//   model_providers  — the upstream configs grouped under an alias. A request
//                      to an alias multiplexes across its configs via the
//                      alias's routing strategy (round_robin | random | failover | latency_weighted).
//   users            — every signed-up user with balances + token leaderboard.
//
// Every route here is behind requireAuth + requireAdmin.

import { Hono } from 'hono'
import { requireAdmin, requireAuth } from '../lib/middleware'
import { decryptSecret, encryptSecret, maskSecret, newId } from '../lib/crypto'
import { pingProvider } from '../lib/ping'
import { EWMA_ALPHA, EWMA_BETA } from '../lib/providers'
import {
  slugify,
  validateBaseUrl,
  validateBearer,
  validateCapabilities,
  validateUpstreamModel,
} from '../lib/validate'
import type { Bindings, ModelProviderRow, ModelRow, Variables } from '../lib/types'

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

// -------------------------------------------------------------- list

app.get('/api/admin/models', async (c) => {
  const models = await c.env.DB.prepare('SELECT * FROM freellm_models ORDER BY sort_order, label').all<ModelRow>()
  const providers = await c.env.DB.prepare('SELECT * FROM freellm_model_providers ORDER BY priority, label').all<ModelProviderRow>()

  const byModel = new Map<string, ModelProviderRow[]>()
  for (const provider of providers.results) {
    const list = byModel.get(provider.model_id) ?? []
    list.push(provider)
    byModel.set(provider.model_id, list)
  }

  const encryptionKey = c.env.ENCRYPTION_KEY
  const modelPayloads = await Promise.all(
    models.results.map(async (model) => ({
      ...model,
      capabilities: safeParseArray(model.capabilities),
      providers: await Promise.all(
        (byModel.get(model.id) ?? []).map(async (provider) => ({
          id: provider.id,
          label: provider.label,
          base_url: provider.base_url,
          upstream_model: provider.upstream_model,
          key_masked: encryptionKey ? await safeKeyMask(provider, encryptionKey) : '••••',
          status: provider.active === 0 ? 'disabled' : provider.status,
          last_checked_at: provider.last_checked_at,
          last_error: provider.last_error,
          avg_latency_ms: provider.avg_latency_ms,
          priority: provider.priority,
          active: provider.active,
          messages_served: provider.messages_served,
          cooldown_ms: provider.cooldown_ms ?? null,
        })),
      ),
    })),
  )

  return c.json({ models: modelPayloads })
})

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

async function safeKeyMask(provider: ModelProviderRow, encryptionKey: string): Promise<string> {
  try {
    return maskSecret(await decryptSecret(provider.api_key_ciphertext, provider.api_key_iv, encryptionKey))
  } catch {
    return '•••• (key unreadable — check ENCRYPTION_KEY)'
  }
}

// ------------------------------------------------------- create alias

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

// ------------------------------------------------ add provider config

app.post('/api/admin/models/:id/providers', async (c) => {
  const modelId = c.req.param('id')
  const model = await c.env.DB.prepare('SELECT id FROM freellm_models WHERE id = ?').bind(modelId).first()
  if (!model) return c.json({ error: 'not_found', message: 'Model not found.' }, 404)

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const label = String(body.label ?? '').trim() || `${String(body.base_url ?? 'provider')}`
  if (label.length > 80) return c.json({ error: 'invalid_input', message: 'Label must be max 80 chars.' }, 400)

  const allowHttp = c.env.ENVIRONMENT !== 'production'
  const urlError = validateBaseUrl(body.base_url, allowHttp)
  if (urlError) return c.json({ error: 'invalid_input', message: urlError }, 400)
  const modelError = validateUpstreamModel(body.upstream_model)
  if (modelError) return c.json({ error: 'invalid_input', message: modelError }, 400)
  const keyError = validateBearer(body.api_key)
  if (keyError) return c.json({ error: 'invalid_input', message: keyError }, 400)

  const encryptionKey = await requireEncryptionKey(c.env)
  const { ciphertext, iv } = await encryptSecret(String(body.api_key).trim(), encryptionKey)

  let cooldownMs: number | null = null
  if (body.cooldown_ms !== undefined && body.cooldown_ms !== null) {
    cooldownMs = Number(body.cooldown_ms)
    if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 604800000) {
      return c.json({ error: 'invalid_input', message: 'Cooldown must be an integer 0–604800000 ms (7 days), or null for the default.' }, 400)
    }
  }

  const id = newId()
  const timestamp = now()
  await c.env.DB.prepare(
    `INSERT INTO freellm_model_providers (id, model_id, label, base_url, upstream_model, api_key_ciphertext, api_key_iv, status, priority, active, messages_served, consecutive_failures, cooldown_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', ?, 1, 0, 0, ?, ?, ?)`,
  )
    .bind(
      id,
      modelId,
      label,
      String(body.base_url).trim().replace(/\/+$/, ''),
      String(body.upstream_model).trim(),
      ciphertext,
      iv,
      Number(body.priority ?? 0),
      cooldownMs,
      timestamp,
      timestamp,
    )
    .run()

  const provider = await c.env.DB.prepare('SELECT * FROM freellm_model_providers WHERE id = ?').bind(id).first<ModelProviderRow>()
  return c.json({ provider: await publicProvider(provider!, encryptionKey) }, 201)
})

// ------------------------------------------------ update provider config

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
  if (body.upstream_model !== undefined) {
    const modelError = validateUpstreamModel(body.upstream_model)
    if (modelError) return c.json({ error: 'invalid_input', message: modelError }, 400)
    updates.upstream_model = String(body.upstream_model).trim()
  }
  if (body.priority !== undefined) {
    const priority = Number(body.priority)
    if (!Number.isInteger(priority)) return c.json({ error: 'invalid_input', message: 'Priority must be an integer.' }, 400)
    updates.priority = priority
  }
  // Retry cooldown after a failure, in milliseconds (0 = retry immediately,
  // null = global 30m default, max 7 days for slow-resetting quotas).
  if (body.cooldown_ms !== undefined) {
    if (body.cooldown_ms === null) {
      updates.cooldown_ms = null
    } else {
      const cooldownMs = Number(body.cooldown_ms)
      if (!Number.isInteger(cooldownMs) || cooldownMs < 0 || cooldownMs > 604800000) {
        return c.json({ error: 'invalid_input', message: 'Cooldown must be an integer 0–604800000 ms (7 days), or null for the default.' }, 400)
      }
      updates.cooldown_ms = cooldownMs
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
  }

  const columns = Object.keys(updates)
  if (columns.length === 0) return c.json({ error: 'invalid_input', message: 'Nothing to update.' }, 400)

  updates.updated_at = now()
  const assignments = columns.map((column) => `${column} = ?`).join(', ')
  await c.env.DB.prepare(`UPDATE freellm_model_providers SET ${assignments} WHERE id = ?`)
    .bind(...columns.map((column) => updates[column]), providerId)
    .run()

  const provider = await c.env.DB.prepare('SELECT * FROM freellm_model_providers WHERE id = ?').bind(providerId).first<ModelProviderRow>()
  return c.json({ provider: await publicProvider(provider!, await requireEncryptionKey(c.env)) })
})

// ------------------------------------------------ delete provider config

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

// ------------------------------------------------------ test connection

app.post('/api/admin/models/:id/providers/:providerId/test', async (c) => {
  const modelId = c.req.param('id')
  const providerId = c.req.param('providerId')
  const provider = await c.env.DB.prepare('SELECT * FROM freellm_model_providers WHERE id = ? AND model_id = ?')
    .bind(providerId, modelId)
    .first<ModelProviderRow>()
  if (!provider) return c.json({ error: 'not_found', message: 'Provider config not found.' }, 404)

  const encryptionKey = await requireEncryptionKey(c.env)
  const apiKey = await decryptSecret(provider.api_key_ciphertext, provider.api_key_iv, encryptionKey)
  const result = await pingProvider(provider.base_url, provider.upstream_model, apiKey)

  const timestamp = now()
  // Same EWMA as pool configs — a single probe must not wipe stream history.
  await c.env.DB.prepare(
    `UPDATE freellm_model_providers
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
      providerId,
    )
    .run()

  const updated = await c.env.DB.prepare('SELECT * FROM freellm_model_providers WHERE id = ?').bind(providerId).first<ModelProviderRow>()
  return c.json({ provider: await publicProvider(updated!, encryptionKey), test: result })
})

// ------------------------------------------------------ reveal pool config key

app.post('/api/admin/models/:id/providers/:providerId/reveal', async (c) => {
  const modelId = c.req.param('id')
  const providerId = c.req.param('providerId')
  const provider = await c.env.DB.prepare('SELECT * FROM freellm_model_providers WHERE id = ? AND model_id = ?')
    .bind(providerId, modelId)
    .first<ModelProviderRow>()
  if (!provider) return c.json({ error: 'not_found', message: 'Provider config not found.' }, 404)

  const encryptionKey = await requireEncryptionKey(c.env)
  const apiKey = await decryptSecret(provider.api_key_ciphertext, provider.api_key_iv, encryptionKey)
  return c.json({ id: provider.id, label: provider.label, api_key: apiKey })
})

async function publicProvider(provider: ModelProviderRow, encryptionKey: string) {
  return {
    id: provider.id,
    label: provider.label,
    base_url: provider.base_url,
    upstream_model: provider.upstream_model,
    key_masked: await safeKeyMask(provider, encryptionKey),
    status: provider.active === 0 ? 'disabled' : provider.status,
    last_checked_at: provider.last_checked_at,
    last_error: provider.last_error,
    avg_latency_ms: provider.avg_latency_ms,
    priority: provider.priority,
    active: provider.active,
    messages_served: provider.messages_served,
    cooldown_ms: provider.cooldown_ms ?? null,
  }
}

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

export default app
