// Auth: password register/login/logout, session resolution for /api/me.
// Google OAuth implemented.

import { Hono } from 'hono'
import { hashPassword, newId, verifyPassword } from '../lib/crypto'
import { createSession, destroySession, getSession, clearedSessionCookie } from '../lib/session'
import { sendVerificationEmail } from '../lib/email'
import {
  generateReferralCode,
  normalizeEmail,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validateUsername,
} from '../lib/validate'
import type { Bindings, PublicUser, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

type UserLike = {
  id: string
  email: string
  username: string
  display_name: string | null
  avatar_url: string | null
  referral_code: string
  balance_credits: number
  role: 'user' | 'admin'
  email_verified: number
  referred_by: string | null
  created_at: number
  updated_at: number
}

const toPublicUser = (row: UserLike): PublicUser => ({
  id: row.id,
  email: row.email,
  username: row.username,
  display_name: row.display_name,
  avatar_url: row.avatar_url,
  referral_code: row.referral_code,
  balance_credits: row.balance_credits,
  role: row.role,
  email_verified: row.email_verified,
  referred_by: row.referred_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
})

/** KV sliding counter; returns false when the caller is over the limit. */
async function allowRequest(kv: KVNamespace, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const now = Date.now()
  const raw = await kv.get(key)
  let entry = { count: 0, resetAt: now + windowSeconds * 1000 }
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { count: number; resetAt: number }
      if (parsed && typeof parsed.count === 'number') entry = parsed
    } catch {
      /* corrupt entry -> reset */
    }
  }
  if (now > entry.resetAt) entry = { count: 0, resetAt: now + windowSeconds * 1000 }
  entry.count += 1
  await kv.put(key, JSON.stringify(entry), { expirationTtl: windowSeconds })
  return entry.count <= limit
}

// ------------------------------------------------------------------ me

app.get('/api/me', async (c) => {
  const session = await getSession(c.env.freellm_sessions, c.req.header('cookie'))
  if (!session) return c.json({ user: null })
  const user = await c.env.DB.prepare('SELECT * FROM freellm_users WHERE id = ?').bind(session.userId).first()
  if (!user) return c.json({ user: null })
  return c.json({ user: toPublicUser(user as UserLike) })
})

// -------------------------------------------------------------- register

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json<{ email?: unknown; username?: unknown; password?: unknown; referral_code?: unknown }>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const email = normalizeEmail(String(body.email ?? ''))
  const username = normalizeUsername(String(body.username ?? ''))
  const password = typeof body.password === 'string' ? body.password : ''

  const invalid =
    validateEmail(email) ??
    validateUsername(username) ??
    validatePassword(password)
  if (invalid) return c.json({ error: 'invalid_input', message: invalid }, 400)

  // Bootstrap rule: the very first account (or ADMIN_EMAIL) becomes admin.
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM freellm_users').first<{ n: number }>()
  const isFirstUser = (count?.n ?? 0) === 0
  const isAdminEmail =
    !!c.env.ADMIN_EMAIL && email === normalizeEmail(c.env.ADMIN_EMAIL)
  const role: 'user' | 'admin' = isFirstUser || isAdminEmail ? 'admin' : 'user'

  const now = Date.now()
  let referralCode = generateReferralCode()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const taken = await c.env.DB.prepare('SELECT 1 FROM freellm_users WHERE referral_code = ?')
      .bind(referralCode)
      .first()
    if (!taken) break
    referralCode = generateReferralCode()
  }

  const userId = newId()
  const passwordHash = await hashPassword(password)

  // Referral attribution: resolve the code before inserting so the row lands
  // atomically with the account. Self-referral is silently ignored.
  let referrerId: string | null = null
  if (typeof body.referral_code === 'string' && body.referral_code.trim() !== '') {
    const referrer = await c.env.DB.prepare('SELECT id FROM freellm_users WHERE referral_code = ?')
      .bind(body.referral_code.trim().toLowerCase())
      .first<{ id: string }>()
    if (referrer && referrer.id !== userId) referrerId = referrer.id
  }

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, referred_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`,
      ).bind(userId, email, username, passwordHash, referralCode, role, referrerId, now, now),
      c.env.DB.prepare(
        `INSERT INTO freellm_auth_identities (id, user_id, provider, subject, email, email_verified, created_at)
         VALUES (?, ?, 'password', ?, ?, 0, ?)`,
      ).bind(newId(), userId, userId, email, now),
      ...(referrerId
        ? [
            c.env.DB.prepare(
              `INSERT INTO freellm_referrals (id, referrer_id, referred_id, status, created_at) VALUES (?, ?, ?, 'waiting', ?)`,
            ).bind(newId(), referrerId, userId, now),
          ]
        : []),
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('UNIQUE constraint failed: freellm_users.email')) {
      return c.json({ error: 'email_taken', message: 'That email is already registered.' }, 409)
    }
    if (message.includes('UNIQUE constraint failed: freellm_users.username')) {
      return c.json({ error: 'username_taken', message: 'That username is taken.' }, 409)
    }
    throw err
  }

  const session = await createSession(c.env.freellm_sessions, userId)
  const user = await c.env.DB.prepare('SELECT * FROM freellm_users WHERE id = ?').bind(userId).first()
  // Fire-and-forget: the dev fallback logs the link; production sends email.
  const verification = await issueVerification(c, userId, email)
  c.header('Set-Cookie', session.cookie)
  const publicUser = toPublicUser(user as UserLike)
  return c.json(
    {
      user: publicUser,
      // Surfaced only outside production, so the flow is testable pre-DNS.
      dev_link: c.env.ENVIRONMENT === 'production' ? undefined : verification.devLink,
    },
    201,
  )
})

// ----------------------------------------------------------------- login

app.post('/api/auth/login', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local'
  if (!(await allowRequest(c.env.freellm_sessions, `rl:login:${ip}`, 10, 15 * 60))) {
    return c.json({ error: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' }, 429)
  }

  const body = await c.req.json<{ email?: unknown; password?: unknown }>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const email = normalizeEmail(String(body.email ?? ''))
  const password = typeof body.password === 'string' ? body.password : ''
  if (validateEmail(email) || !password) {
    return c.json({ error: 'invalid_input', message: 'Enter your email and password.' }, 400)
  }

  const user = await c.env.DB.prepare('SELECT * FROM freellm_users WHERE email = ?').bind(email).first<{
    id: string
    password_hash: string | null
  }>()
  // Same response whether the email is unknown or the password is wrong.
  const invalid = { error: 'invalid_credentials', message: 'Email or password is incorrect.' }
  if (!user || !user.password_hash) return c.json(invalid, 401)
  if (!(await verifyPassword(password, user.password_hash))) return c.json(invalid, 401)

  const session = await createSession(c.env.freellm_sessions, user.id)
  const full = await c.env.DB.prepare('SELECT * FROM freellm_users WHERE id = ?').bind(user.id).first()
  c.header('Set-Cookie', session.cookie)
  return c.json({ user: toPublicUser(full as UserLike) })
})

// ---------------------------------------------------------------- logout

app.post('/api/auth/logout', async (c) => {
  await destroySession(c.env.freellm_sessions, c.req.header('cookie'))
  c.header('Set-Cookie', clearedSessionCookie())
  return c.json({ ok: true })
})

// ------------------------------------------------------ email verification

app.post('/api/auth/verify-email', async (c) => {
  const body = await c.req.json<{ token?: unknown }>().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) return c.json({ error: 'invalid_input', message: 'A verification token is required.' }, 400)

  const row = await c.env.DB.prepare(
    'SELECT user_id, email, expires_at, consumed_at FROM freellm_email_verifications WHERE token = ?',
  )
    .bind(token)
    .first<{ user_id: string; email: string; expires_at: number; consumed_at: number | null }>()

  if (!row) return c.json({ error: 'invalid_token', message: 'That verification link is not valid.' }, 400)
  if (row.consumed_at) return c.json({ error: 'already_used', message: 'That link was already used.' }, 409)
  if (Date.now() > row.expires_at) {
    return c.json({ error: 'expired', message: 'That link expired — request a new one.' }, 410)
  }

  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE freellm_users SET email_verified = 1, updated_at = ? WHERE id = ?').bind(now, row.user_id),
    c.env.DB.prepare('UPDATE freellm_auth_identities SET email_verified = 1 WHERE user_id = ?').bind(row.user_id),
    c.env.DB.prepare('UPDATE freellm_email_verifications SET consumed_at = ? WHERE token = ?').bind(now, token),
  ])

  return c.json({ ok: true })
})

app.post('/api/auth/resend-verification', async (c) => {
  const session = await getSession(c.env.freellm_sessions, c.req.header('cookie'))
  if (!session) return c.json({ error: 'unauthorized', message: 'Sign in to continue.' }, 401)

  const user = await c.env.DB.prepare('SELECT id, email, email_verified FROM freellm_users WHERE id = ?')
    .bind(session.userId)
    .first<{ id: string; email: string; email_verified: number }>()
  if (!user) return c.json({ error: 'unauthorized', message: 'Sign in to continue.' }, 401)
  if (user.email_verified === 1) return c.json({ error: 'already_verified', message: 'Your email is already verified.' }, 409)

  // Rate limit: one resend per minute.
  const recent = await c.env.DB.prepare(
    'SELECT created_at FROM freellm_email_verifications WHERE user_id = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1',
  )
    .bind(user.id)
    .first<{ created_at: number }>()
  if (recent && Date.now() - recent.created_at < 60_000) {
    return c.json({ error: 'rate_limited', message: 'Wait a minute before requesting another link.' }, 429)
  }

  const { link, devLink } = await issueVerification(c, user.id, user.email)
  return c.json({ ok: true, dev_link: devLink, link })
})

/** Creates a verification token, invalidates prior ones, sends the email. */
export async function issueVerification(
  c: { env: Bindings; req: { url: string } },
  userId: string,
  email: string,
): Promise<{ link: string; devLink?: string }> {
  const token = newId()
  const now = Date.now()
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM freellm_email_verifications WHERE user_id = ? AND consumed_at IS NULL').bind(userId),
    c.env.DB.prepare(
      'INSERT INTO freellm_email_verifications (token, user_id, email, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)',
    ).bind(token, userId, email, now + 24 * 60 * 60 * 1000, now),
  ])
  const origin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin
  const link = `${origin}/verify-email?token=${token}`
  const result = await sendVerificationEmail(c.env, email, link)
  return { link, devLink: result.devLink }
}

// Returns true when the signed-in user may earn credits.
export function isVerified(user: { email_verified: number }): boolean {
  return user.email_verified === 1
}

// ----------------------------------------------------------------- Google OAuth

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

function buildGoogleAuthUrl(env: Bindings, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: `${env.PUBLIC_ORIGIN ?? 'https://freellm.hasit.in'}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

async function exchangeCodeForTokens(env: Bindings, code: string, redirectUri: string) {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? '',
    client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!response.ok) {
    const error = await response.text().catch(() => '')
    throw new Error(`Token exchange failed: ${response.status} ${error}`)
  }
  return response.json<{ access_token: string; id_token?: string; refresh_token?: string; expires_in: number }>()
}

async function fetchGoogleUser(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error('Failed to fetch Google user info')
  return response.json<{ sub: string; email: string; email_verified: boolean; name: string; picture: string }>()
}

app.get('/api/auth/google', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return c.json({ error: 'not_configured', message: 'Google OAuth is not configured.' }, 500)
  }
  const state = newId()
  const origin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin
  // Remember where the caller wanted to land, so the callback can send them
  // there instead of a hardcoded page. Same-site paths only (no open redirect).
  const next = c.req.query('next')
  const safeNext = typeof next === 'string' && /^\/[^/\\]/.test(next) ? next : null
  await c.env.freellm_sessions.put(
    `oauth:state:${state}`,
    JSON.stringify({ origin, next: safeNext }),
    { expirationTtl: 600 },
  )
  return c.redirect(buildGoogleAuthUrl(c.env, state))
})

app.get('/api/auth/google/callback', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return c.text('Google OAuth is not configured.', 500)
  }

  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')

  if (error) {
    return c.redirect(`${c.env.PUBLIC_ORIGIN ?? 'https://freellm.hasit.in'}/login?error=${encodeURIComponent(error)}`)
  }
  if (!code || !state) {
    return c.text('Missing code or state.', 400)
  }

  const storedRaw = await c.env.freellm_sessions.get(`oauth:state:${state}`)
  await c.env.freellm_sessions.delete(`oauth:state:${state}`)
  // States are JSON {origin, next}; tolerate a legacy plain-origin state.
  let redirectOrigin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin
  let nextPath = '/dashboard'
  try {
    const parsed = JSON.parse(storedRaw ?? '{}') as { origin?: string; next?: string | null }
    if (typeof parsed?.origin === 'string' && parsed.origin) redirectOrigin = parsed.origin
    if (typeof parsed?.next === 'string' && /^\/[^/\\]/.test(parsed.next)) nextPath = parsed.next
  } catch {
    if (storedRaw) redirectOrigin = storedRaw
  }
  const redirectUri = `${redirectOrigin}/api/auth/google/callback`

  try {
    const tokens = await exchangeCodeForTokens(c.env, code, redirectUri)
    const googleUser = await fetchGoogleUser(tokens.access_token)
    if (!googleUser.email_verified) {
      return c.redirect(`${redirectOrigin}/login?error=${encodeURIComponent('Google email not verified.')}`)
    }

    const email = normalizeEmail(googleUser.email)
    const now = Date.now()

    // Find existing user by email
    let user = await c.env.DB.prepare('SELECT * FROM freellm_users WHERE email = ?').bind(email).first<UserLike>()

    if (!user) {
      // Create new user
      const usernameBase = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
      let username = usernameBase
      for (let i = 0; i < 10; i++) {
        const taken = await c.env.DB.prepare('SELECT 1 FROM freellm_users WHERE username = ?').bind(username).first()
        if (!taken) break
        username = `${usernameBase}${i + 1}`
      }

      const referralCode = generateReferralCode()
      const userId = newId()
      const isFirstUser = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM freellm_users').first<{ n: number }>())?.n === 0
      const isAdminEmail = !!c.env.ADMIN_EMAIL && email === normalizeEmail(c.env.ADMIN_EMAIL)
      const role: 'user' | 'admin' = isFirstUser || isAdminEmail ? 'admin' : 'user'

      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, referred_by, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, 0, ?, 1, NULL, ?, ?)`,
        ).bind(userId, email, username, referralCode, role, now, now),
        c.env.DB.prepare(
          `INSERT INTO freellm_auth_identities (id, user_id, provider, subject, email, email_verified, created_at)
           VALUES (?, ?, 'google', ?, ?, 1, ?)`,
        ).bind(newId(), userId, googleUser.sub, email, now),
      ])

      user = await c.env.DB.prepare('SELECT * FROM freellm_users WHERE id = ?').bind(userId).first()
    } else {
      // Link Google identity if not already linked
      const existing = await c.env.DB.prepare(
        'SELECT 1 FROM freellm_auth_identities WHERE user_id = ? AND provider = ?',
      ).bind(user.id, 'google').first()
      if (!existing) {
        await c.env.DB.prepare(
          `INSERT INTO freellm_auth_identities (id, user_id, provider, subject, email, email_verified, created_at)
           VALUES (?, ?, 'google', ?, ?, 1, ?)`,
        ).bind(newId(), user.id, googleUser.sub, email, now)
      }
      // Ensure email_verified is set
      if (user.email_verified !== 1) {
        await c.env.DB.prepare('UPDATE freellm_users SET email_verified = 1, updated_at = ? WHERE id = ?').bind(now, user.id)
      }
    }

    const session = await createSession(c.env.freellm_sessions, user!.id)
    c.header('Set-Cookie', session.cookie)
    return c.redirect(`${redirectOrigin}${nextPath}`)
  } catch (err) {
    console.error('[oauth] Google callback error:', err)
    return c.redirect(`${redirectOrigin}/login?error=${encodeURIComponent('Authentication failed.')}`)
  }
})

export default app
