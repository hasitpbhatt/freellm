// M6: the BYOK vault ("Your Key" — Door 1 of the Two Doors model).
//
// A BYOK entry is the user's own OpenAI-compatible endpoint config. Keys are
// stored ENCRYPTED at rest (AES-256-GCM with ENCRYPTION_KEY); the operator can
// reveal them on demand via the admin endpoints below — that's the deliberate
// trade: encrypted in the store, visible to the operator.
//
// Chatting through your own key is free and unmetered — it never touches The Pool.
//
//   GET    /api/keys                  list the caller's keys (masked)
//   POST   /api/keys                  add + validate a key
//   POST   /api/keys/:id/test         re-validate, update liveness
//   DELETE /api/keys/:id
//
// Operator visibility (admin):
//   GET  /api/admin/vault                 every user key, masked
//   POST /api/admin/vault/:id/reveal      decrypted key
//   POST /api/admin/providers/:pid/reveal decrypted pool config key

import { Hono } from 'hono'
import { requireAdmin, requireAuth } from '../lib/middleware'
import { decryptSecret, decryptForDisplay, encryptSecret, maskSecret, newId } from '../lib/crypto'
import { pingProvider } from '../lib/ping'
import { validateBaseUrl, validateBearer, validateUpstreamModel } from '../lib/validate'
import type { Bindings, ApiKeyRow, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const now = () => Date.now()

const ROLLING_AVG_ALPHA = 0.3
const ROLLING_AVG_BETA = 0.7

const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_ADDS_PER_WINDOW = 5
const MAX_TESTS_PER_WINDOW = 10

async function checkRateLimit(
  kv: KVNamespace,
  userId: string,
  action: 'add' | 'test',
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const key = `ratelimit:keys:${action}:${userId}`
  const windowStart = now() - RATE_LIMIT_WINDOW_MS

  // Sliding window: store timestamps in a sorted set (using JSON array in KV)
  const raw = await kv.get(key)
  let timestamps: number[] = []
  try {
    const parsed = raw ? JSON.parse(raw) : []
    timestamps = Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'number') : []
  } catch {
    timestamps = []
  }
  timestamps = timestamps.filter((t) => t > windowStart)

  const max = action === 'add' ? MAX_ADDS_PER_WINDOW : MAX_TESTS_PER_WINDOW
  if (timestamps.length >= max) {
    const oldest = timestamps[0]
    return { allowed: false, remaining: 0, resetAt: oldest + RATE_LIMIT_WINDOW_MS }
  }

  timestamps.push(now())
  await kv.put(key, JSON.stringify(timestamps), { expirationTtl: 120 })
  return { allowed: true, remaining: max - timestamps.length, resetAt: now() + RATE_LIMIT_WINDOW_MS }
}

function requireEncryptionKey(env: Bindings): string | null {
  return env.ENCRYPTION_KEY || null
}

async function maskRow(row: ApiKeyRow, encryption: string): Promise<string> {
  return decryptForDisplay(row, encryption)
}

function publicKey(row: ApiKeyRow, keyMasked: string) {
  return {
    id: row.id,
    label: row.label,
    base_url: row.base_url,
    upstream_model: row.upstream_model,
    key_masked: keyMasked,
    status: row.active === 0 ? ('disabled' as const) : row.status,
    last_checked_at: row.last_checked_at,
    last_error: row.last_error,
    avg_latency_ms: row.avg_latency_ms,
    messages_served: row.messages_served,
    created_at: row.created_at,
  }
}

// =====================================================================
// User vault
// =====================================================================

app.use('/api/keys/*', requireAuth)

app.get('/api/keys', async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare('SELECT * FROM freellm_api_keys WHERE user_id = ? ORDER BY created_at DESC')
    .bind(user.id)
    .all<ApiKeyRow>()

  const encryption = requireEncryptionKey(c.env)
  const keys = encryption
    ? await Promise.all(rows.results.map(async (row) => publicKey(row, await maskRow(row, encryption))))
    : rows.results.map((row) => publicKey(row, '••••'))

  return c.json({ keys })
})

app.post('/api/keys', async (c) => {
  const user = c.get('user')
  const rateLimit = await checkRateLimit(c.env.freellm_sessions, user.id, 'add')
  if (!rateLimit.allowed) {
    return c.json(
      { error: 'rate_limited', message: 'Too many key additions. Try again in a minute.' },
      429,
    )
  }

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const label = String(body.label ?? '').trim()
  if (!label || label.length > 80) {
    return c.json({ error: 'invalid_input', message: 'A label (max 80 chars) is required.' }, 400)
  }
  const allowHttp = c.env.ENVIRONMENT !== 'production'
  const urlError = validateBaseUrl(body.base_url, allowHttp)
  if (urlError) return c.json({ error: 'invalid_input', message: urlError }, 400)
  const modelError = validateUpstreamModel(body.upstream_model)
  if (modelError) return c.json({ error: 'invalid_input', message: modelError }, 400)
  const keyError = validateBearer(body.api_key)
  if (keyError) return c.json({ error: 'invalid_input', message: keyError }, 400)

  const baseUrl = String(body.base_url).trim().replace(/\/+$/, '')
  const upstreamModel = String(body.upstream_model).trim()
  const apiKey = String(body.api_key).trim()

  // Validate before storing: a dead key is useless in the vault.
  const ping = await pingProvider(baseUrl, upstreamModel, apiKey)

  const encryption = requireEncryptionKey(c.env)
  if (!encryption) {
    return c.json({ error: 'not_configured', message: 'ENCRYPTION_KEY is not set on this deployment.' }, 500)
  }
  const { ciphertext, iv } = await encryptSecret(apiKey, encryption)

  const id = newId()
  const timestamp = now()
  await c.env.DB.prepare(
    `INSERT INTO freellm_api_keys (id, user_id, provider, label, base_url, upstream_model,
                           key_ciphertext, key_iv, status, last_checked_at, last_error,
                           avg_latency_ms, active, messages_served, created_at, updated_at)
     VALUES (?, ?, 'byok', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      label,
      baseUrl,
      upstreamModel,
      ciphertext,
      iv,
      ping.ok ? ping.status : 'down',
      timestamp,
      ping.error ?? null,
      ping.latencyMs,
      timestamp,
      timestamp,
    )
    .run()

  return c.json(
    {
      key: {
        id,
        label,
        base_url: baseUrl,
        upstream_model: upstreamModel,
        key_masked: maskSecret(apiKey),
        status: ping.ok ? ping.status : 'down',
        last_error: ping.error ?? null,
      },
      test: ping,
    },
    201,
  )
})

app.post('/api/keys/:id/test', async (c) => {
  const user = c.get('user')
  const rateLimit = await checkRateLimit(c.env.freellm_sessions, user.id, 'test')
  if (!rateLimit.allowed) {
    return c.json(
      { error: 'rate_limited', message: 'Too many key tests. Try again in a minute.' },
      429,
    )
  }

  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT * FROM freellm_api_keys WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<ApiKeyRow>()
  if (!row) return c.json({ error: 'not_found', message: 'Key not found.' }, 404)

  const encryption = requireEncryptionKey(c.env)
  if (!encryption) {
    return c.json({ error: 'not_configured', message: 'ENCRYPTION_KEY is not set on this deployment.' }, 500)
  }
  const apiKey = await decryptSecret(row.key_ciphertext, row.key_iv, encryption)
  const ping = await pingProvider(row.base_url, row.upstream_model, apiKey)

  const timestamp = now()
  await c.env.DB.prepare(
    `UPDATE freellm_api_keys
     SET status = ?, last_checked_at = ?, last_error = ?,
         avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN ?
                               ELSE CAST(avg_latency_ms * ? + ? * ? AS INTEGER) END,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      ping.ok ? ping.status : 'down',
      timestamp,
      ping.error ?? null,
      ping.latencyMs,
      ROLLING_AVG_BETA,
      ping.latencyMs,
      ROLLING_AVG_ALPHA,
      timestamp,
      id,
    )
    .run()

  return c.json({ test: ping })
})

app.delete('/api/keys/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id FROM freellm_api_keys WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first()
  if (!row) return c.json({ error: 'not_found', message: 'Key not found.' }, 404)
  await c.env.DB.prepare('DELETE FROM freellm_api_keys WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// =====================================================================
// Operator visibility (admin) — encrypted at rest, revealable on demand
// =====================================================================

app.use('/api/admin/vault/*', requireAuth, requireAdmin)
app.use('/api/admin/providers/:pid/reveal', requireAuth, requireAdmin)

app.get('/api/admin/vault', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT k.*, u.username, u.email FROM freellm_api_keys k JOIN freellm_users u ON u.id = k.user_id
     ORDER BY k.created_at DESC LIMIT 200`,
  ).all<ApiKeyRow & { username: string; email: string }>()

  const encryption = requireEncryptionKey(c.env)
  const keys = encryption
    ? await Promise.all(
        rows.results.map(async (row) => ({
          ...publicKey(row, await maskRow(row, encryption)),
          username: row.username,
          email: row.email,
        })),
      )
    : rows.results.map((row) => ({ ...publicKey(row, '••••'), username: row.username, email: row.email }))

  return c.json({ keys })
})

app.post('/api/admin/vault/:id/reveal', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT * FROM freellm_api_keys WHERE id = ?').bind(id).first<ApiKeyRow>()
  if (!row) return c.json({ error: 'not_found', message: 'Key not found.' }, 404)

  const encryption = requireEncryptionKey(c.env)
  if (!encryption) {
    return c.json({ error: 'not_configured', message: 'ENCRYPTION_KEY is not set on this deployment.' }, 500)
  }
  const apiKey = await decryptSecret(row.key_ciphertext, row.key_iv, encryption)
  return c.json({ id, label: row.label, api_key: apiKey })
})

export default app
