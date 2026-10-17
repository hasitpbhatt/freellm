// Auth: password register/login/logout, session resolution for /api/me.
// Google OAuth implemented.

import { Hono } from 'hono'
import { newId } from '../lib/crypto'
import { isEmailBlocked } from '../lib/email-blocks'
import { createSession, destroySession, getSession, clearedSessionCookie } from '../lib/session'
import { sendVerificationEmail } from '../lib/email'
import { generateReferralCode, normalizeEmail } from '../lib/validate'
import { allowRequest } from '../lib/ratelimit'
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
  tier: 'free' | 'pro' | 'enterprise'
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
  tier: row.tier ?? 'free',
  email_verified: row.email_verified,
  referred_by: row.referred_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
})

// ------------------------------------------------------------------ me

app.get('/api/me', async (c) => {
  const session = await getSession(c.env.freellm_sessions, c.req.header('cookie'))
  if (!session) return c.json({ user: null })
  const user = await c.env.DB.prepare('SELECT * FROM freellm_users WHERE id = ?').bind(session.userId).first()
  if (!user) return c.json({ user: null })
  return c.json({ user: toPublicUser(user as UserLike) })
})

// ------------------------------------------------------------- OAuth only
// Password registration and login are removed: signup and signin happen
// exclusively via Google. Existing password users sign in with Google on the
// same email address and are auto-linked to their existing account.

// ---------------------------------------------------------------- logout

app.post('/api/auth/logout', async (c) => {
  await destroySession(c.env.freellm_sessions, c.req.header('cookie'))
  c.header('Set-Cookie', clearedSessionCookie())
  return c.json({ ok: true })
})

// ------------------------------------------------------ email verification

app.post('/api/auth/verify-email', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'local'
  if (!(await allowRequest(c.env.freellm_sessions, `rl:verify:${ip}`, 10, 15 * 60))) {
    return c.json({ error: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' }, 429)
  }
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
  // Conditional consume — concurrent double-use: only one wins.
  const consumed = (await c.env.DB.prepare('UPDATE freellm_email_verifications SET consumed_at = ? WHERE token = ? AND consumed_at IS NULL')
    .bind(now, token)
    .run() as unknown as { meta?: { changes?: number } })
  if (typeof consumed?.meta?.changes === 'number' && consumed.meta.changes === 0) {
    return c.json({ error: 'already_used', message: 'That link was already used.' }, 409)
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE freellm_users SET email_verified = 1, updated_at = ? WHERE id = ?').bind(now, row.user_id),
    c.env.DB.prepare('UPDATE freellm_auth_identities SET email_verified = 1 WHERE user_id = ?').bind(row.user_id),
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
  // Never leak the raw token in production responses.
  const isProd = c.env.ENVIRONMENT === 'production'
  return c.json({ ok: true, dev_link: isProd ? undefined : devLink, link: isProd ? undefined : link })
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
  const ip = c.req.header('cf-connecting-ip') ?? 'local'
  if (!(await allowRequest(c.env.freellm_sessions, `rl:oauth:${ip}`, 20, 10 * 60))) {
    return c.json({ error: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' }, 429)
  }
  const state = newId()
  const origin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin
  // Remember where the caller wanted to land, so the callback can send them
  // there instead of a hardcoded page. Same-site paths only (no open redirect).
  const next = c.req.query('next')
  const safeNext = typeof next === 'string' && /^\/[^/\\]/.test(next) ? next : null
  // Referral attribution survives the Google round-trip inside the state.
  const refRaw = c.req.query('ref')
  const ref =
    typeof refRaw === 'string' && /^[a-z0-9]{2,32}$/i.test(refRaw.trim()) ? refRaw.trim().toLowerCase() : null
  await c.env.freellm_sessions.put(
    `oauth:state:${state}`,
    JSON.stringify({ origin, next: safeNext, ref }),
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
  if (!storedRaw) {
    return c.text('Invalid or expired OAuth state.', 400)
  }
  // States are JSON {origin, next}; tolerate a legacy plain-origin state.
  // Never trust stored origin for redirects — use server config only.
  const redirectOrigin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin
  let nextPath = '/dashboard'
  let stateRef: string | null = null
  try {
    const parsed = JSON.parse(storedRaw) as { next?: string | null; ref?: string | null }
    if (typeof parsed?.next === 'string') {
      let decoded = parsed.next
      try {
        decoded = decodeURIComponent(parsed.next)
      } catch {
        decoded = parsed.next
      }
      if (/^\/[^/\\]/.test(decoded) && !decoded.startsWith('/%')) nextPath = parsed.next
    }
    if (typeof parsed?.ref === 'string' && /^[a-z0-9]{2,32}$/i.test(parsed.ref)) {
      stateRef = parsed.ref.toLowerCase()
    }
  } catch {
    // malformed state — keep default nextPath
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

    // Admin email blocklist: regexes on the normalized email. A match
    // rejects the sign-in before any account is created or session issued.
    // Applies to returning users too — a blocked address cannot sign in.
    const blockedBy = await isEmailBlocked(c.env.DB, email)
    if (blockedBy) {
      console.warn('[oauth] blocked sign-in attempt for pattern match')
      return c.redirect(`${redirectOrigin}/login?error=${encodeURIComponent('That email domain is not allowed.')}`)
    }

    // Find existing user by email
    let user = await c.env.DB.prepare('SELECT * FROM freellm_users WHERE email = ?').bind(email).first<UserLike>()

    if (!user) {
      // Create new user
      const rawBase = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
      const usernameBase = rawBase.length >= 3 ? rawBase : `user${Date.now().toString(36).slice(-6)}`
      let username = usernameBase
      for (let i = 0; i < 10; i++) {
        const taken = await c.env.DB.prepare('SELECT 1 FROM freellm_users WHERE username = ?').bind(username).first()
        if (!taken) break
        username = `${usernameBase.slice(0, 18)}${i + 1}`
        if (i === 9) username = `${usernameBase.slice(0, 12)}${Date.now().toString(36).slice(-6)}`
      }

      let referralCode = generateReferralCode()
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const taken = await c.env.DB.prepare('SELECT 1 FROM freellm_users WHERE referral_code = ?')
          .bind(referralCode)
          .first()
        if (!taken) break
        referralCode = generateReferralCode()
      }
      const userId = newId()

      // Referral attribution for OAuth signups: resolve the code stashed in
      // the state before inserting. Self-referral is silently ignored.
      let referrerId: string | null = null
      if (stateRef) {
        const referrer = await c.env.DB.prepare('SELECT id FROM freellm_users WHERE referral_code = ?')
          .bind(stateRef)
          .first<{ id: string }>()
        if (referrer && referrer.id !== userId) referrerId = referrer.id
      }
      const isFirstUser = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM freellm_users').first<{ n: number }>())?.n === 0
      const isAdminEmail = !!c.env.ADMIN_EMAIL && email === normalizeEmail(c.env.ADMIN_EMAIL)
      const role: 'user' | 'admin' = isFirstUser || isAdminEmail ? 'admin' : 'user'

      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, referred_by, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, 0, ?, 1, ?, ?, ?)`,
        ).bind(userId, email, username, referralCode, role, referrerId, now, now),
        c.env.DB.prepare(
          `INSERT INTO freellm_auth_identities (id, user_id, provider, subject, email, email_verified, created_at)
           VALUES (?, ?, 'google', ?, ?, 1, ?)`,
        ).bind(newId(), userId, googleUser.sub, email, now),
        ...(referrerId
          ? [
              c.env.DB.prepare(
                `INSERT INTO freellm_referrals (id, referrer_id, referred_id, status, created_at) VALUES (?, ?, ?, 'waiting', ?)`,
              ).bind(newId(), referrerId, userId, now),
            ]
          : []),
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
