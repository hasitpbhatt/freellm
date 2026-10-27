import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import authRoutes from '../routes/auth'
import adminRoutes from '../routes/admin'
import promoRoutes from '../routes/promos'
import chatRoutes from '../routes/chat'
import economyRoutes from '../routes/economy'
import keysRoutes from '../routes/keys'
import apiKeyRoutes from '../routes/apikeys'
import openAiRoutes from '../routes/openai'
import gamesRoutes from '../routes/games'
import oauthRoutes from '../routes/oauth'
import type { Bindings, Variables } from '../lib/types'

/**
 * freellm API — Cloudflare Pages Functions (Workers runtime).
 *
 * Bindings (see wrangler.toml):
 *   DB        — D1 (SQLite): users, ledgers, usage events, model catalog
 *   SESSIONS  — KV: session tokens, OAuth state, rate limits
 *   ENVIRONMENT — 'development' | 'production'
 *   ENCRYPTION_KEY — base64 32-byte key for AES-256-GCM (provider bearers, BYOK)
 *   ADMIN_EMAIL — address that auto-gets the admin role at registration
 */
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.onError((err, c) => {
  console.error(`[api] ${c.req.method} ${c.req.path} failed:`, err)

  // Typed HttpError from our routes
  if (err && typeof err === 'object' && 'status' in err && 'code' in err) {
    const e = err as { status: number; code: string; message: string }
    return new Response(JSON.stringify({ error: e.code, message: e.message }), {
      status: e.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Validation errors (Zod etc.)
  if (err?.name === 'ZodError') {
    return new Response(JSON.stringify({ error: 'invalid_input', message: err.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: 'internal_error', message: 'Something broke on our side.' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })
})

app.notFound((c) => c.json({ error: 'not_found', message: `No route for ${c.req.path}` }, 404))

// ---------------------------------------------------------------- health
app.get('/api/health', async (c) => {
  let db: 'ok' | 'error' = 'error'
  try {
    await c.env.DB.prepare('SELECT 1 AS ping').first()
    db = 'ok'
  } catch {
    db = 'error'
  }
  return c.json({ ok: db === 'ok', env: c.env.ENVIRONMENT, db })
})

// ------------------------------------------------------------- routers
app.route('/', authRoutes)
app.route('/', adminRoutes)
app.route('/', promoRoutes)
app.route('/', chatRoutes)
app.route('/', economyRoutes)
app.route('/', keysRoutes)
app.route('/', apiKeyRoutes)
app.route('/', openAiRoutes)
app.route('/', gamesRoutes)
app.route('/', oauthRoutes)

export const onRequest = handle(app)