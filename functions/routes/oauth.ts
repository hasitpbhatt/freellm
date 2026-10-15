// OAuth routes for freellm - PKCE / device flows that land OAuth credentials
// from personal accounts (Codex, Google, Antigravity, Grok Build, Kilo, Qoder)
// straight into the caller's BYOK vault, pre-filled from the registry so no
// endpoint details are ever typed. Wiring matches 9router's MIT-licensed
// registry (see functions/lib/oauth.ts for the source map).

import { Hono, type Context } from 'hono'
import { requireAuth } from '../lib/middleware'
import { accountFromIdToken, getOAuthProviderConfig, isOAuthProvider, OAUTH_PROVIDERS, oauthProviderList, providerClientId, providerClientSecret, providerIdForVaultRow, type OAuthProviderConfig } from '../lib/oauth'
import {
  fetchQoderUserInfo,
  initiateQoderDeviceFlow,
  pollKiloDeviceCode,
  pollQoderDeviceToken,
  requestKiloDeviceCode,
} from '../lib/oauth-device'
import { decryptSecret, encryptSecret, newId } from '../lib/crypto'
import { retireSupersededConnection } from '../lib/connections'
import type { Bindings, Variables, ConnectionRow } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// PKCE helpers
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function requireEncryptionKey(env: Bindings): string | null {
  return env.ENCRYPTION_KEY || null
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)

// OAuth flow state (PKCE verifier, device code) lives in KV with a TTL, not in
// module memory: the /start, callback, and poll requests can each land on a
// different Worker isolate, where an in-memory Map would be empty.
type PkceData = { verifier: string; provider: string; userId: string; state: string }
type DeviceCodeData = {
  deviceStyle: 'rfc' | 'kilo' | 'qoder'
  deviceCode: string
  userCode: string
  interval: number
  expiresAt: number
  provider: string
  userId: string
  state: string
  verifier?: string
  machineId?: string
}

const PKCE_STATE_TTL_S = 10 * 60
const DEVICE_STATE_TTL_S = 15 * 60

function isPkceData(value: unknown): value is PkceData {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.verifier === 'string' && typeof v.provider === 'string' && typeof v.userId === 'string'
}

function isDeviceCodeData(value: unknown): value is DeviceCodeData {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    (v.deviceStyle === 'rfc' || v.deviceStyle === 'kilo' || v.deviceStyle === 'qoder') &&
    typeof v.deviceCode === 'string' &&
    typeof v.provider === 'string' &&
    typeof v.userId === 'string'
  )
}

async function storeOauthState(kv: KVNamespace, key: string, value: PkceData | DeviceCodeData, ttlSeconds: number): Promise<void> {
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds })
}

async function loadOauthState<T extends PkceData | DeviceCodeData>(
  kv: KVNamespace,
  key: string,
  guard: (value: unknown) => value is T,
): Promise<T | null> {
  const value: unknown = await kv.get(key, 'json')
  return guard(value) ? value : null
}

/** Callback origin derived from the live request, not a static BASE_URL. */
function callbackUrl(c: { req: { url: string } }, providerId: string): string {
  return `${new URL(c.req.url).origin}/api/oauth/callback/${providerId}`
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  /** Present for openid providers (google, antigravity, codex). */
  id_token?: string
}

/**
 * Persists a freshly-issued OAuth credential as a vault row, pre-filled from
 * the registry (endpoint, model, protocol) — the callback never stores blank
 * base_url/upstream_model. Refresh tokens are kept only for providers whose
 * refresh actually works (qoder/kilo: re-connect instead).
 */
async function saveOAuthVaultKey(
  env: Bindings,
  opts: {
    userId: string
    config: OAuthProviderConfig
    accessToken: string
    refreshToken?: string | null
    expiresAt?: number | null
    accountId?: string | null
    /** Appended to the auto label, e.g. an email: "Qoder (user@x.com) (Auto)". */
    labelSuffix?: string | null
  },
): Promise<string> {
  const encryption = requireEncryptionKey(env)
  if (!encryption) throw new Error('ENCRYPTION_KEY not set')
  const { userId, config, accessToken } = opts
  const { ciphertext: keyCiphertext, iv: keyIv } = await encryptSecret(accessToken, encryption)
  let refreshCiphertext: string | null = null
  let refreshIv: string | null = null
  if (config.refreshable && opts.refreshToken) {
    const sealed = await encryptSecret(opts.refreshToken, encryption)
    refreshCiphertext = sealed.ciphertext
    refreshIv = sealed.iv
  }
  const fill = config.vaultFill
  const suffix = opts.labelSuffix?.trim() ? ` (${opts.labelSuffix.trim().slice(0, 40)})` : ''
  const id = newId()
  const timestamp = Date.now()
  // Reconnecting an account must not stack live duplicates: retireSuperseded
  // Connection() decides which older rows this connect supersedes (same
  // account, or one legacy account-less row) and leaves different accounts —
  // a second Google login, a Kilo org binding — untouched.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO freellm_connections (id, owner_id, scope, provider, label, base_url, upstream_model,
                             key_ciphertext, key_iv, auth_kind, protocol, account_id,
                             refresh_ciphertext, refresh_iv, expires_at,
                             status, last_checked_at, last_error,
                             avg_latency_ms, active, messages_served, created_at, updated_at)
       VALUES (?, ?, 'personal', ?, ?, ?, ?, ?, ?, 'oauth', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    ).bind(
      id,
      userId,
      config.id,
      `${fill.label}${suffix} (Auto)`,
      fill.baseUrl,
      fill.upstreamModel,
      keyCiphertext,
      keyIv,
      fill.protocol,
      opts.accountId ?? null,
      refreshCiphertext,
      refreshIv,
      opts.expiresAt ?? null,
      'live',
      timestamp,
      null,
      null,
      timestamp,
      timestamp,
    ),
    retireSupersededConnection(env.DB, {
      now: timestamp,
      userId,
      baseUrl: fill.baseUrl,
      accountId: opts.accountId ?? null,
      keepId: id,
    }),
  ])
  return id
}

// =====================================================================
// Provider list (drives the Connect buttons; only wired-up providers)
// =====================================================================
app.use('/api/oauth/*', requireAuth)

app.get('/api/oauth/providers', async (c) => {
  return c.json({
    providers: oauthProviderList(c.env).map((p) => ({
      id: p.id,
      name: p.name,
      flowType: OAUTH_PROVIDERS[p.id].flowType,
      deviceStyle: OAUTH_PROVIDERS[p.id].deviceStyle ?? null,
      chatReady: p.chatReady,
    })),
  })
})

// =====================================================================
// Start OAuth flow
// =====================================================================

app.get('/api/oauth/start/:provider', async (c) => {
  const user = c.get('user')
  const providerId = c.req.param('provider')

  if (!isOAuthProvider(providerId)) {
    return c.json({ error: 'invalid_provider', message: 'Unknown OAuth provider.' }, 400)
  }

  const config = getOAuthProviderConfig(providerId)
  if (!config) {
    return c.json({ error: 'not_configured', message: 'Provider not configured.' }, 500)
  }

  // The client id is env-provided for Google/Antigravity; without it the flow
  // would redirect with an empty `client_id=` and die on the provider's error
  // page. The UI hides unconfigured providers, but the endpoint is reachable.
  if (!providerClientId(c.env, config)) {
    return c.json({ error: 'not_configured', message: 'Provider not configured.' }, 500)
  }

  const state = crypto.randomUUID()

  if (config.flowType === 'device_code') {
    return startDeviceFlow(c, config, providerId, user.id, state)
  }

  // Authorization Code Flow with PKCE (Codex, Google, Antigravity)
  if (!config.authorizeUrl) {
    return c.json({ error: 'not_configured', message: 'Authorize URL not configured' }, 500)
  }
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: providerClientId(c.env, config) ?? '',
    redirect_uri: callbackUrl(c, providerId),
    scope: config.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(config.extraParams ?? {}),
  })

  const authUrl = `${config.authorizeUrl}?${params.toString()}`

  // Store the PKCE verifier in KV; the TTL replaces the old cleanup timer.
  await storeOauthState(c.env.freellm_sessions, `oauth:state:${state}`, { verifier, provider: providerId, userId: user.id, state }, PKCE_STATE_TTL_S)

  return c.json({ authUrl, state })
})

async function startDeviceFlow(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  config: OAuthProviderConfig,
  providerId: string,
  userId: string,
  state: string,
) {
  // --- Kilo: POST initiate (JSON, empty body) ---
  if (config.deviceStyle === 'kilo') {
    if (!config.initiateUrl || !config.pollUrlBase || !config.profileUrl) {
      return c.json({ error: 'not_configured', message: 'Device URLs not configured' }, 500)
    }
    try {
      const initiated = await requestKiloDeviceCode(config.initiateUrl)
      await storeOauthState(c.env.freellm_sessions, `oauth:device:${state}`, {
        deviceStyle: 'kilo',
        deviceCode: initiated.deviceCode,
        userCode: initiated.userCode,
        interval: initiated.interval,
        expiresAt: Date.now() + initiated.expiresIn * 1000,
        provider: providerId,
        userId,
        state,
      }, DEVICE_STATE_TTL_S)
      return c.json({
        authUrl: initiated.verificationUri,
        deviceCode: initiated.deviceCode,
        userCode: initiated.userCode,
        verificationUri: initiated.verificationUri,
        interval: initiated.interval,
        expiresIn: initiated.expiresIn,
        state,
      })
    } catch (err) {
      return c.json({ error: 'device_code_failed', message: err instanceof Error ? err.message : 'Unknown error' }, 502)
    }
  }

  // --- Qoder: PKCE + nonce + machine_id generated locally; the user opens
  // the login URL carrying challenge/nonce, we poll by nonce+verifier. ---
  if (config.deviceStyle === 'qoder') {
    if (!config.loginUrl || !config.deviceTokenUrl) {
      return c.json({ error: 'not_configured', message: 'Device URLs not configured' }, 500)
    }
    const flow = await initiateQoderDeviceFlow(config.loginUrl)
    await storeOauthState(c.env.freellm_sessions, `oauth:device:${state}`, {
      deviceStyle: 'qoder',
      deviceCode: flow.nonce,
      userCode: flow.userCode,
      interval: 2,
      expiresAt: Date.now() + 300 * 1000,
      provider: providerId,
      userId,
      state,
      verifier: flow.verifier,
      machineId: flow.machineId,
    }, DEVICE_STATE_TTL_S)
    return c.json({
      authUrl: flow.verificationUriComplete,
      userCode: flow.userCode,
      verificationUri: config.loginUrl,
      verificationUriComplete: flow.verificationUriComplete,
      interval: 2,
      expiresIn: 300,
      state,
    })
  }

  // --- RFC 8628 (Grok): POST deviceCodeUrl, poll tokenUrl ---
  if (!config.deviceCodeUrl) {
    return c.json({ error: 'not_configured', message: 'Device code URL not configured' }, 500)
  }
  try {
    const response = await fetch(config.deviceCodeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        client_id: providerClientId(c.env, config) ?? '',
        scope: config.scope,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return c.json({ error: 'device_code_failed', message: `Device code request failed: ${error}` }, 502)
    }

    interface DeviceCodeResponse {
      device_code: string
      user_code: string
      verification_uri: string
      verification_uri_complete?: string
      expires_in: number
      interval: number
      error?: string
    }
    const data = (await response.json()) as DeviceCodeResponse
    const authUrl = data.verification_uri_complete || `${data.verification_uri}?user_code=${data.user_code}`

    // Store device code for polling
    await storeOauthState(c.env.freellm_sessions, `oauth:device:${state}`, {
      deviceStyle: 'rfc',
      deviceCode: data.device_code,
      userCode: data.user_code,
      interval: data.interval || 5,
      expiresAt: Date.now() + (data.expires_in || 900) * 1000,
      provider: providerId,
      userId,
      state,
    }, DEVICE_STATE_TTL_S)

    return c.json({
      authUrl,
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      interval: data.interval || 5,
      expiresIn: data.expires_in || 900,
      state,
    })
  } catch (err) {
    return c.json({ error: 'device_code_failed', message: err instanceof Error ? err.message : 'Unknown error' }, 502)
  }
}

// =====================================================================
// OAuth callback handler
// =====================================================================
app.get('/api/oauth/callback/:provider', async (c) => {
  const providerId = c.req.param('provider')

  if (!isOAuthProvider(providerId)) {
    return c.html(`<h1>Unknown provider</h1>`, 400)
  }

  const config = getOAuthProviderConfig(providerId)
  if (!config) {
    return c.html(`<h1>Server not configured</h1><p>Provider not configured</p>`, 500)
  }

  // Extract config properties we need
  const { tokenUrl } = config
  const exchangeClientId = providerClientId(c.env, config)
  const exchangeSecret = providerClientSecret(c.env, config)

  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')
  const errorDescription = c.req.query('error_description')

  if (error) {
    return c.html(`
      <h1>OAuth Error</h1>
      <p>${escapeHtml(errorDescription || error)}</p>
      <a href="/keys">Back to Keys</a>
    `, 400)
  }

  if (!code || !state) {
    return c.html(`<h1>Invalid callback</h1><p>Missing code or state</p>`, 400)
  }

  // Get the stored PKCE data from KV (shared across Worker isolates)
  const stateKey = `oauth:state:${state}`
  const pkceData = await loadOauthState(c.env.freellm_sessions, stateKey, isPkceData)
  if (!pkceData || pkceData.provider !== providerId) {
    return c.html(`<h1>Invalid state</h1><p>State expired or invalid</p>`, 400)
  }

  // The browser that started the flow must still be signed in as the same
  // user: otherwise a session swap mid-flow (shared computer) would land one
  // person's freshly-authorized token in another person's vault.
  const me = c.get('user')
  if (!me || pkceData.userId !== me.id) {
    return c.html(`<h1>Signed in as someone else</h1><p>The account changed since this connect started — start over from /keys.</p><a href="/keys">Back to Keys</a>`, 403)
  }

  await c.env.freellm_sessions.delete(stateKey).catch(() => {})

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl(c, providerId),
        client_id: exchangeClientId ?? '',
        ...(exchangeSecret ? { client_secret: exchangeSecret } : {}),
        code_verifier: pkceData.verifier,
      }),
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      return c.html(`<h1>Token exchange failed</h1><p>${escapeHtml(error)}</p>`, 502)
    }

    const tokens = (await tokenResponse.json().catch(() => ({}))) as TokenResponse
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
      return c.html(`<h1>Token exchange failed</h1><p>The provider answered without an access token — try connecting again.</p>`, 502)
    }

    // Providers that answer with an id_token (google, antigravity, codex) name
    // the signed-in account there. Capture it: the vault retires older live
    // rows per (base_url, account_id), so without an account id a second
    // Google account would silently disable the first, and neither row would
    // say which account it holds.
    const account = tokens.id_token ? accountFromIdToken(tokens.id_token) : null

    // Store in the user's vault, pre-filled from the registry
    await saveOAuthVaultKey(c.env, {
      userId: pkceData.userId,
      config,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
      accountId: account?.id ?? null,
      labelSuffix: account?.email ?? null,
    })

    // Redirect back to keys page with success
    return c.redirect('/keys?oauth=success')
  } catch (err) {
    return c.html(`<h1>Error</h1><p>${escapeHtml(err instanceof Error ? err.message : 'Unknown error')}</p>`, 500)
  }
})

// =====================================================================
// Device code polling endpoint
// =====================================================================
app.post('/api/oauth/poll/:provider', async (c) => {
  const user = c.get('user')
  const providerId = c.req.param('provider')
  const body = await c.req.json().catch(() => ({}))
  const { state } = body as { state?: string }

  if (!isOAuthProvider(providerId)) {
    return c.json({ error: 'invalid_provider' }, 400)
  }

  const config = getOAuthProviderConfig(providerId)
  if (!config || config.flowType !== 'device_code') {
    return c.json({ error: 'not_device_flow' }, 400)
  }

  const deviceKey = `oauth:device:${state}`
  const flow = await loadOauthState(c.env.freellm_sessions, deviceKey, isDeviceCodeData)
  if (!flow || flow.provider !== providerId || flow.userId !== user.id) {
    return c.json({ error: 'invalid_state' }, 400)
  }

  // --- Kilo: GET pollUrlBase/{code}, then profile for the org id ---
  if (flow.deviceStyle === 'kilo') {
    if (!config.pollUrlBase || !config.profileUrl) {
      return c.json({ status: 'error', error: 'Device URLs not configured' })
    }
    const polled = await pollKiloDeviceCode(config.pollUrlBase, config.profileUrl, flow.deviceCode)
    if (polled.status === 'pending') return c.json({ status: 'pending' })
    if (polled.status === 'error') return c.json({ status: 'error', error: polled.error })
    let keyId: string
    try {
      keyId = await saveOAuthVaultKey(c.env, {
        userId: user.id,
        config,
        accessToken: polled.accessToken,
        accountId: polled.orgId,
        labelSuffix: polled.email,
      })
    } catch {
      return c.json({ status: 'error', error: 'Token received but vault save failed.' })
    }
    await c.env.freellm_sessions.delete(deviceKey).catch(() => {})
    return c.json({ status: 'success', keyId })
  }

  // --- Qoder: GET deviceTokenUrl?nonce=&verifier=, then userinfo ---
  if (flow.deviceStyle === 'qoder') {
    if (!config.deviceTokenUrl || !config.userInfoUrl) {
      return c.json({ status: 'error', error: 'Device URLs not configured' })
    }
    if (!flow.verifier) return c.json({ status: 'error', error: 'Flow state incomplete — restart the connect.' })
    try {
      const polled = await pollQoderDeviceToken(config.deviceTokenUrl, flow.deviceCode, flow.verifier)
      if (polled.status === 'pending') return c.json({ status: 'pending' })
      const userInfo = await fetchQoderUserInfo(config.userInfoUrl, polled.accessToken)
      const keyId = await saveOAuthVaultKey(c.env, {
        userId: user.id,
        config,
        accessToken: polled.accessToken,
        refreshToken: polled.refreshToken,
        expiresAt: polled.expiresAt,
        labelSuffix: userInfo.email || (polled.userId ? `user-${polled.userId}` : null),
      }).catch(() => null)
      if (!keyId) return c.json({ status: 'error', error: 'Token received but vault save failed.' })
      await c.env.freellm_sessions.delete(deviceKey).catch(() => {})
      return c.json({ status: 'success', keyId })
    } catch (err) {
      return c.json({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  // --- RFC 8628 (Grok) ---
  const { tokenUrl } = config

  // Define the interface outside the try block
  interface DeviceCodeTokenResponse {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    error?: string
    error_description?: string
  }

  try {
    const pollClientId = providerClientId(c.env, config)
    const pollSecret = providerClientSecret(c.env, config)
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: flow.deviceCode,
        client_id: pollClientId ?? '',
        ...(pollSecret ? { client_secret: pollSecret } : {}),
      }),
    })

    const data = (await response.json().catch(() => null)) as DeviceCodeTokenResponse | null
    if (!data || typeof data !== 'object') {
      return c.json({ status: 'error', error: 'The provider answered with a non-JSON response — try again.' })
    }

    if (data.error === 'authorization_pending') {
      return c.json({ status: 'pending' })
    }

    if (data.error === 'slow_down') {
      flow.interval += 5
      await storeOauthState(c.env.freellm_sessions, deviceKey, flow, DEVICE_STATE_TTL_S)
      return c.json({ status: 'slow_down', interval: flow.interval })
    }

    if (data.error) {
      return c.json({ status: 'error', error: data.error })
    }

    // Success - store in the vault, pre-filled from the registry
    const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null

    const keyId = await saveOAuthVaultKey(c.env, {
      userId: user.id,
      config,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    }).catch(() => null)
    if (!keyId) return c.json({ status: 'error', error: 'Token received but vault save failed.' })

    await c.env.freellm_sessions.delete(deviceKey).catch(() => {})

    return c.json({ status: 'success', keyId })
  } catch (err) {
    return c.json({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

// =====================================================================
// Refresh token endpoint (on-demand refresh)
// =====================================================================
app.post('/api/keys/:id/refresh', requireAuth, async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const row = await c.env.DB.prepare(
    "SELECT * FROM freellm_connections WHERE id = ? AND owner_id = ? AND scope = 'personal'",
  )
    .bind(id, user.id)
    .first<ConnectionRow>()

  if (!row) {
    return c.json({ error: 'not_found', message: 'Key not found.' }, 404)
  }

  if ((row.auth_kind ?? 'api_key') !== 'oauth') {
    return c.json({ error: 'not_oauth', message: 'Only OAuth keys can be refreshed.' }, 400)
  }

  if (!row.refresh_ciphertext || !row.refresh_iv) {
    return c.json({ error: 'no_refresh_token', message: 'No refresh token stored for this key.' }, 400)
  }

  const encryption = requireEncryptionKey(c.env)
  if (!encryption) {
    return c.json({ error: 'not_configured', message: 'ENCRYPTION_KEY not set.' }, 500)
  }

  const refreshToken = await decryptSecret(row.refresh_ciphertext, row.refresh_iv, encryption)

  // Determine provider from the vault row (exact registry base_url first).
  const providerId = providerIdForVaultRow(row.base_url, row.label)

  if (!providerId || !isOAuthProvider(providerId)) {
    return c.json({ error: 'unknown_provider', message: 'Cannot determine OAuth provider for this key.' }, 400)
  }

  const config = getOAuthProviderConfig(providerId)
  if (!config) {
    return c.json({ error: 'provider_not_configured' }, 500)
  }

  // Some device-token providers have no usable refresh (qoder 403s, kilo
  // issues none) — reconnect instead of failing against the upstream.
  if (!config.refreshable) {
    return c.json({ error: 'not_refreshable', message: 'This account does not support refresh — reconnect it from /keys.' }, 400)
  }

  try {
    const refreshClientId = providerClientId(c.env, config)
    const refreshSecret = providerClientSecret(c.env, config)
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: refreshClientId ?? '',
        ...(refreshSecret ? { client_secret: refreshSecret } : {}),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      return c.json({ error: 'refresh_failed', message: `Token refresh failed: ${error}` }, 502)
    }

    const tokens = (await response.json()) as TokenResponse

    // Update stored tokens
    const { ciphertext: keyCiphertext, iv: keyIv } = await encryptSecret(tokens.access_token, encryption)

    let newRefreshCiphertext = row.refresh_ciphertext
    let newRefreshIv = row.refresh_iv
    if (tokens.refresh_token) {
      const sealed = await encryptSecret(tokens.refresh_token, encryption)
      newRefreshCiphertext = sealed.ciphertext
      newRefreshIv = sealed.iv
    }

    const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null

    // A successful refresh fully restores the row: a stale future cooldown or
    // down flag must not keep a just-refreshed key out of rotation.
    const refreshedAt = Date.now()
    await c.env.DB.prepare(
      `UPDATE freellm_connections
       SET key_ciphertext = ?, key_iv = ?, refresh_ciphertext = ?, refresh_iv = ?, expires_at = ?,
           status = 'live', last_checked_at = ?, last_error = NULL, updated_at = ?
       WHERE id = ?`,
    ).bind(keyCiphertext, keyIv, newRefreshCiphertext, newRefreshIv, expiresAt, refreshedAt, refreshedAt, id).run()

    return c.json({
      ok: true,
      expiresAt,
      message: 'Token refreshed successfully',
    })
  } catch (err) {
    return c.json({ error: 'refresh_failed', message: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

export default app
