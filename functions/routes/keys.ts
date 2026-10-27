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
import { CODEX_DEFAULT_ENDPOINT, validateAccountId, validateAuthKind, validateBaseUrl, validateBearer, validateExpiryTimestamp, validateOAuthToken, validateProtocol, validateRefreshToken, validateUpstreamModel } from '../lib/validate'
import { pingCodex } from '../lib/codex'
import { listPersonalConnections, publicConnection } from '../lib/connections'
import { writeAuditLog, getClientInfo, validateJustification } from '../lib/audit'
import type { Bindings, ConnectionRow, Variables } from '../lib/types'

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

async function maskRow(row: ConnectionRow, encryption: string): Promise<string> {
  return decryptForDisplay(row, encryption)
}

// The vault list reuses the one canonical client-safe shape (lib/connections)
// and only adds the masked secret, which the shared helper intentionally omits.
function publicKey(row: ConnectionRow, keyMasked: string) {
  return { ...publicConnection(row), key_masked: keyMasked }
}

// =====================================================================
// User vault
// =====================================================================

app.use('/api/keys/*', requireAuth)

app.get('/api/keys', async (c) => {
  const user = c.get('user')
  const rows = await listPersonalConnections(c.env, user.id)

  const encryption = requireEncryptionKey(c.env)
  const keys = encryption
    ? await Promise.all(rows.map(async (row) => publicKey(row, await maskRow(row, encryption))))
    : rows.map((row) => publicKey(row, '••••'))

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

  const body = await c.req.json<Record<string, unknown> | Record<string, unknown>[]>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  // Support both single key object and array of keys
  const keysInput = Array.isArray(body) ? body : [body]

  // Validate each key first
  const validatedKeys: Array<{
    label: string
    protocol: 'openai' | 'codex'
    accountId: string | null
    baseUrl: string
    upstreamModel: string
    authKind: 'api_key' | 'oauth'
    apiKey: string
    refreshToken: string | null
    expiresAt: number | null
  }> = []

  for (const item of keysInput) {
    const label = String(item.label ?? '').trim()
    if (!label || label.length > 80) {
      return c.json({ error: 'invalid_input', message: 'Each key must have a label (max 80 chars).' }, 400)
    }
    const protocol = validateProtocol(item.protocol)
    if (!protocol) return c.json({ error: 'invalid_input', message: "protocol must be 'openai' or 'codex'." }, 400)
    const accountId = validateAccountId(item.account_id)
    if (item.account_id != null && item.account_id !== '' && accountId == null) {
      return c.json({ error: 'invalid_input', message: 'Account ID must be 1–128 characters.' }, 400)
    }
    if (accountId != null && protocol !== 'codex') {
      return c.json({ error: 'invalid_input', message: 'account_id is only supported for Codex accounts.' }, 400)
    }
    const allowHttp = c.env.ENVIRONMENT !== 'production'
    const rawBaseUrl = protocol === 'codex' && (item.base_url == null || String(item.base_url).trim() === '')
      ? CODEX_DEFAULT_ENDPOINT
      : item.base_url
    const urlError = validateBaseUrl(rawBaseUrl, allowHttp)
    if (urlError) return c.json({ error: 'invalid_input', message: urlError }, 400)
    const modelError = validateUpstreamModel(item.upstream_model)
    if (modelError) return c.json({ error: 'invalid_input', message: modelError }, 400)
    const authKind = validateAuthKind(item.auth_kind)
    if (!authKind) return c.json({ error: 'invalid_input', message: "auth_kind must be 'api_key' or 'oauth'." }, 400)
    if (protocol === 'codex' && authKind !== 'oauth') {
      return c.json({ error: 'invalid_input', message: 'Codex accounts need auth_kind oauth (your ChatGPT OAuth access token).' }, 400)
    }
    const keyError = authKind === 'oauth' ? validateOAuthToken(item.api_key) : validateBearer(item.api_key)
    if (keyError) return c.json({ error: 'invalid_input', message: keyError }, 400)
    const refreshError = validateRefreshToken(item.refresh_token)
    if (refreshError) return c.json({ error: 'invalid_input', message: refreshError }, 400)
    if (item.refresh_token != null && item.refresh_token !== '' && authKind !== 'oauth') {
      return c.json({ error: 'invalid_input', message: 'refresh_token is only supported for OAuth accounts.' }, 400)
    }
    const expiresAt = validateExpiryTimestamp(item.expires_at)
    if (expiresAt === 'invalid') return c.json({ error: 'invalid_input', message: 'expires_at must be a unix epoch timestamp in milliseconds.' }, 400)
    if (expiresAt != null && authKind !== 'oauth') {
      return c.json({ error: 'invalid_input', message: 'expires_at is only supported for OAuth accounts.' }, 400)
    }

    const baseUrl = String(rawBaseUrl).trim().replace(/\/+$/, '')
    const upstreamModel = String(item.upstream_model).trim()
    const apiKey = String(item.api_key).trim()
    const refreshToken = item.refresh_token != null && item.refresh_token !== '' ? String(item.refresh_token).trim() : null

    validatedKeys.push({ label, protocol, accountId, baseUrl, upstreamModel, authKind, apiKey, refreshToken, expiresAt })
  }

  // Rate limit: count each key as one addition
  if (validatedKeys.length > rateLimit.remaining) {
    return c.json({ error: 'rate_limited', message: `Can add ${rateLimit.remaining} more keys this minute.` }, 429)
  }

  // Process each key
  const encryption = requireEncryptionKey(c.env)
  if (!encryption) {
    return c.json({ error: 'not_configured', message: 'ENCRYPTION_KEY is not set on this deployment.' }, 500)
  }

  const results = []
  for (const key of validatedKeys) {
    const ping = key.protocol === 'codex'
      ? await pingCodex(key.baseUrl, key.upstreamModel, key.apiKey, key.accountId).then((r) => ({ ...r, mode: 'chat' as const }))
      : await pingProvider(key.baseUrl, key.upstreamModel, key.apiKey)

    const { ciphertext, iv } = await encryptSecret(key.apiKey, encryption)
    let refreshCiphertext: string | null = null
    let refreshIv: string | null = null
    if (key.refreshToken) {
      const sealed = await encryptSecret(key.refreshToken, encryption)
      refreshCiphertext = sealed.ciphertext
      refreshIv = sealed.iv
    }

    const id = newId()
    const timestamp = now()
    await c.env.DB.prepare(
      `INSERT INTO freellm_connections (id, owner_id, scope, provider, label, base_url, upstream_model,
                             key_ciphertext, key_iv, auth_kind, protocol, account_id,
                             refresh_ciphertext, refresh_iv, expires_at,
                             status, last_checked_at, last_error,
                             avg_latency_ms, active, messages_served, created_at, updated_at)
         VALUES (?, ?, 'personal', 'byok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    )
      .bind(
        id,
        user.id,
        key.label,
        key.baseUrl,
        key.upstreamModel,
        ciphertext,
        iv,
        key.authKind,
        key.protocol,
        key.accountId,
        refreshCiphertext,
        refreshIv,
        key.expiresAt,
        ping.ok ? ping.status : 'down',
        timestamp,
        ping.error ?? null,
        ping.latencyMs,
        timestamp,
        timestamp,
      )
      .run()

    results.push({
      key: {
        id,
        label: key.label,
        base_url: key.baseUrl,
        upstream_model: key.upstreamModel,
        key_masked: maskSecret(key.apiKey),
        auth_kind: key.authKind,
        protocol: key.protocol,
        account_id: key.accountId,
        has_refresh_token: refreshCiphertext != null,
        expires_at: key.expiresAt,
        status: ping.ok ? ping.status : 'down',
        last_error: ping.error ?? null,
      },
      test: ping,
    })
  }

return c.json({ keys: results }, 201)
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
  const row = await c.env.DB.prepare(
    "SELECT * FROM freellm_connections WHERE id = ? AND owner_id = ? AND scope = 'personal'",
  )
    .bind(id, user.id)
    .first<ConnectionRow>()
  if (!row) return c.json({ error: 'not_found', message: 'Key not found.' }, 404)
  if ((row.auth_kind ?? 'api_key') === 'oauth' && row.expires_at != null && row.expires_at <= now()) {
    return c.json({ error: 'key_expired', message: 'This OAuth token has expired — replace it before using.' }, 400)
  }

  const encryption = requireEncryptionKey(c.env)
  if (!encryption) {
    return c.json({ error: 'not_configured', message: 'ENCRYPTION_KEY is not set on this deployment.' }, 500)
  }
  const apiKey = await decryptSecret(row.key_ciphertext, row.key_iv, encryption)
  const ping = (row.protocol ?? 'openai') === 'codex'
    ? await pingCodex(row.base_url, row.upstream_model, apiKey, row.account_id).then((r) => ({ ...r, mode: 'chat' as const }))
    : await pingProvider(row.base_url, row.upstream_model, apiKey)

  const timestamp = now()
  await c.env.DB.prepare(
    `UPDATE freellm_connections
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
  const row = await c.env.DB.prepare(
    "SELECT id FROM freellm_connections WHERE id = ? AND owner_id = ? AND scope = 'personal'",
  )
    .bind(id, user.id)
    .first()
  if (!row) return c.json({ error: 'not_found', message: 'Key not found.' }, 404)
  await c.env.DB.prepare('DELETE FROM freellm_connections WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// =====================================================================
// Operator visibility (admin) — encrypted at rest, revealable on demand
// =====================================================================

app.use('/api/admin/vault/*', requireAuth, requireAdmin)
app.use('/api/admin/providers/:pid/reveal', requireAuth, requireAdmin)

app.get('/api/admin/vault', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT k.*, u.username, u.email FROM freellm_connections k JOIN freellm_users u ON u.id = k.owner_id
     ORDER BY k.created_at DESC LIMIT 200`,
  ).all<ConnectionRow & { username: string; email: string }>()

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
  const admin = c.get('user')
  const body = await c.req.json<{ justification?: unknown }>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_input', message: 'Request body is required.' }, 400)
  const justificationError = validateJustification(body.justification)
  if (justificationError) return c.json({ error: 'invalid_input', message: justificationError }, 400)

  const row = await c.env.DB.prepare('SELECT * FROM freellm_connections WHERE id = ?').bind(id).first<ConnectionRow>()
  if (!row) return c.json({ error: 'not_found', message: 'Key not found.' }, 404)
  // OAuth access tokens belong to the user's own provider account and are
  // never revealable — not even to the operator. Refresh tokens are never
  // returned by any endpoint, period.
  if ((row.auth_kind ?? 'api_key') === 'oauth') {
    console.warn(`[vault] blocked admin reveal of OAuth credential ${id}`)
    return c.json({ error: 'forbidden', message: 'OAuth credentials cannot be revealed.' }, 403)
  }

  const encryption = requireEncryptionKey(c.env)
  if (!encryption) {
    return c.json({ error: 'not_configured', message: 'ENCRYPTION_KEY is not set on this deployment.' }, 500)
  }
  const apiKey = await decryptSecret(row.key_ciphertext, row.key_iv, encryption)

  // Write audit log AFTER successful reveal
  const { ip, user_agent } = getClientInfo(c)
  await writeAuditLog(c.env, {
    admin_id: admin.id,
    action: 'vault_reveal',
    target_type: 'connection',
    target_id: id,
    justification: body.justification as string,
    ip,
    user_agent,
  })

  return c.json({ id, label: row.label, api_key: apiKey })
})

export default app
