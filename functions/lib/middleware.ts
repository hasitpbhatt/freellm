// Hono middleware: session resolution + role guards.

import { createMiddleware } from 'hono/factory'
import type { Bindings, UserRow, Variables } from './types'
import { getSession } from './session'
import { sha256Hex } from './crypto'

type Env = { Bindings: Bindings; Variables: Variables }

async function loadUser(db: D1Database, userId: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM freellm_users WHERE id = ?').bind(userId).first<UserRow>()
}

/**
 * Resolves a `fl_…` API token (Bearer) to its user, refreshing last_used_at.
 * Returns null when the token is unknown or malformed.
 */
async function loadUserByApiToken(db: D1Database, token: string): Promise<UserRow | null> {
  const row = await db
    .prepare(
      `SELECT u.*, t.id AS token_id FROM freellm_api_tokens t JOIN freellm_users u ON u.id = t.user_id WHERE t.token_hash = ?`,
    )
    .bind(await sha256Hex(token))
    .first<UserRow & { token_id: string }>()
  if (!row) return null
  // Best-effort freshness marker; a stale write must not block the request.
  await db.prepare('UPDATE freellm_api_tokens SET last_used_at = ? WHERE id = ?').bind(Date.now(), row.token_id).run().catch(() => {})
  return row
}

/** Resolves the session when present; attaches `user` or null. Never blocks. */
export const resolveUser = createMiddleware<Env>(async (c, next) => {
  const session = await getSession(c.env.freellm_sessions, c.req.header('cookie'))
  const user = session ? await loadUser(c.env.DB, session.userId) : null
  c.set('user', (user ?? undefined) as Variables['user'])
  await next()
})

/** 401s unless a valid session exists. */
export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const session = await getSession(c.env.freellm_sessions, c.req.header('cookie'))
  const user = session ? await loadUser(c.env.DB, session.userId) : null
  if (!user) return c.json({ error: 'unauthorized', message: 'Sign in to continue.' }, 401)
  c.set('user', user)
  await next()
})

/** 403s unless the session user has the admin role (assumes requireAuth ran first). */
export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthorized', message: 'Sign in to continue.' }, 401)
  if (user.role !== 'admin') {
    return c.json({ error: 'forbidden', message: 'Admin access required.' }, 403)
  }
  await next()
})

/**
 * 401s unless the request is authenticated by EITHER a session cookie OR an
 * `Authorization: Bearer fl_…` API token. Used by the /v1 OpenAI-compatible
 * surface; the native /api/* surface keeps cookie-only requireAuth.
 */
export const requireAuthOrToken = createMiddleware<Env>(async (c, next) => {
  const auth = c.req.header('Authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (bearer.startsWith('fl_')) {
    const user = await loadUserByApiToken(c.env.DB, bearer)
    if (!user) {
      return c.json({ error: 'unauthorized', message: 'That API token is not valid. Create one on /developers.' }, 401)
    }
    c.set('user', user)
    await next()
    return
  }
  const session = await getSession(c.env.freellm_sessions, c.req.header('cookie'))
  const user = session ? await loadUser(c.env.DB, session.userId) : null
  if (!user) return c.json({ error: 'unauthorized', message: 'Sign in to continue.' }, 401)
  c.set('user', user)
  await next()
})
