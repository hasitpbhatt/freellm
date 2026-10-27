// Personal API tokens — Bearer auth for the /v1 surface.
//
//   GET    /api/tokens        list the caller's tokens (prefix + usage only)
//   POST   /api/tokens        create one; the raw fl_… token is returned ONCE
//   DELETE /api/tokens/:id    revoke
//
// Tokens spend from the caller's credit balance (the same metering as the
// web chat), so creation is gated behind a verified email — the same
// anti-farming gate the earning surface uses.

import { Hono } from 'hono'
import { requireAuth } from '../lib/middleware'
import { newApiToken, newId, sha256Hex } from '../lib/crypto'
import { getUsableConnection } from '../lib/connections'
import type { Bindings, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const now = () => Date.now()

const MAX_PER_HOUR = 5
const RATE_WINDOW_MS = 3_600_000

const VERIFIED_REQUIRED = {
  error: 'verification_required',
  message: 'Verify your email before creating API tokens.',
}

async function rateLimited(kv: KVNamespace, userId: string): Promise<boolean> {
  const key = `ratelimit:tokens:${userId}`
  const raw = await kv.get(key)
  let recent: number[] = []
  try {
    recent = raw ? (JSON.parse(raw) as number[]) : []
    if (!Array.isArray(recent)) recent = []
  } catch {
    recent = []
  }
  const windowStart = now() - RATE_WINDOW_MS
  recent = recent.filter((t) => typeof t === 'number' && t > windowStart)
  if (recent.length >= MAX_PER_HOUR) return true
  recent.push(now())
  await kv.put(key, JSON.stringify(recent), { expirationTtl: 3600 })
  return false
}

app.use('/api/tokens', requireAuth)
app.use('/api/tokens/*', requireAuth)

app.get('/api/tokens', async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    'SELECT id, label, token_prefix, connection_id, last_used_at, created_at FROM freellm_api_tokens WHERE user_id = ? ORDER BY created_at DESC',
  )
    .bind(user.id)
    .all<{ id: string; label: string; token_prefix: string; connection_id: string | null; last_used_at: number | null; created_at: number }>()
  return c.json({ tokens: rows.results })
})

app.post('/api/tokens', async (c) => {
  const user = c.get('user')
  if (user.email_verified !== 1) {
    return c.json(VERIFIED_REQUIRED, 403)
  }
  if (await rateLimited(c.env.freellm_sessions, user.id)) {
    return c.json({ error: 'rate_limited', message: 'Too many tokens created. Try again in an hour.' }, 429)
  }

  const body = await c.req.json<{ label?: unknown; connection_id?: unknown }>().catch(() => null)
  const label = typeof body?.label === 'string' ? body.label.trim() : ''
  if (label.length < 1 || label.length > 80) {
    return c.json({ error: 'invalid_input', message: 'A label (1–80 chars) is required.' }, 400)
  }

  // Optional binding: this token then dials that connection for every call,
  // so the client never has to pass key_mode/key_id (plain OpenAI contract).
  let connectionId: string | null = null
  if (typeof body?.connection_id === 'string' && body.connection_id) {
    const conn = await getUsableConnection(c.env, user.id, body.connection_id)
    if (!conn) {
      return c.json({ error: 'invalid_input', message: 'That connection does not exist or is not available to you.' }, 400)
    }
    connectionId = conn.id
  }

  const token = newApiToken()
  const id = newId()
  const prefix = `${token.slice(0, 6)}…${token.slice(-4)}`
  const timestamp = now()

  await c.env.DB.prepare(
    'INSERT INTO freellm_api_tokens (id, user_id, label, token_prefix, token_hash, connection_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, user.id, label, prefix, await sha256Hex(token), connectionId, timestamp)
    .run()

  return c.json(
    {
      token, // shown once — we keep only the hash after this response
      record: { id, label, token_prefix: prefix, connection_id: connectionId, last_used_at: null, created_at: timestamp },
    },
    201,
  )
})

app.delete('/api/tokens/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT id FROM freellm_api_tokens WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<{ id: string }>()
  if (!row) return c.json({ error: 'not_found', message: 'Token not found.' }, 404)
  await c.env.DB.prepare('DELETE FROM freellm_api_tokens WHERE id = ? AND user_id = ?').bind(id, user.id).run()
  return c.json({ ok: true })
})

export default app
