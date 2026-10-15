// Device-flow helpers for the non-RFC OAuth providers, ported from 9router's
// MIT-licensed implementation (src/lib/oauth/providers/{kilocode,qoder}.js +
// src/lib/oauth/services/qoder.js). Web Crypto only — runs in Workers and Node.
//
// Kilo:  POST {initiateUrl} (JSON, empty body) -> { code, verificationUrl,
//          expiresIn }; GET {pollUrlBase}/{code} -> 202 pending / 403 denied /
//          410 expired / 200 { status: 'approved', token, userEmail }; then a
//          Bearer profile lookup yields the org id (stored as account_id for
//          the X-Kilocode-OrganizationID header).
// Qoder: PKCE + nonce + machine_id are generated LOCALLY; the user opens
//          {loginUrl}?challenge=&challenge_method=S256&machine_id=&nonce= ;
//          we GET {deviceTokenUrl}?nonce=&verifier=&challenge_method=S256 until
//          200 { token, refresh_token, user_id, expires_at/expires_in }.
//          202/404 = pending. Tokens live ~30d; refresh is a no-op upstream
//          (403), so the registry marks qoder refreshable: false.

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}

// ------------------------------------------------------------------- kilo

export interface KiloDeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export async function requestKiloDeviceCode(initiateUrl: string): Promise<KiloDeviceCode> {
  const response = await fetch(initiateUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
  if (response.status === 429) {
    throw new Error('Too many pending authorization requests. Please try again later.')
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(`Device auth initiation failed: ${detail || response.statusText}`)
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  const code = typeof data.code === 'string' ? data.code : ''
  const verificationUrl = typeof data.verificationUrl === 'string' ? data.verificationUrl : ''
  if (!code || !verificationUrl) throw new Error('Device auth initiation returned no code.')
  return {
    deviceCode: code,
    userCode: code,
    verificationUri: verificationUrl,
    expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : 300,
    interval: 3,
  }
}

export type KiloPollResult =
  | { status: 'pending' }
  | { status: 'error'; error: string }
  | { status: 'success'; accessToken: string; email: string | null; orgId: string | null }

export async function pollKiloDeviceCode(pollUrlBase: string, profileUrl: string, deviceCode: string): Promise<KiloPollResult> {
  const response = await fetch(`${pollUrlBase.replace(/\/+$/, '')}/${encodeURIComponent(deviceCode)}`)
  if (response.status === 202) return { status: 'pending' }
  if (response.status === 403) return { status: 'error', error: 'Authorization denied by user' }
  if (response.status === 410) return { status: 'error', error: 'Authorization code expired' }
  if (!response.ok) return { status: 'error', error: `Poll failed: ${response.status}` }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (data.status !== 'approved' || typeof data.token !== 'string') return { status: 'pending' }
  const token = data.token as string
  const email = typeof data.userEmail === 'string' ? data.userEmail : null
  let orgId: string | null = null
  try {
    const profileRes = await fetch(profileUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (profileRes.ok) {
      const profile = (await profileRes.json().catch(() => ({}))) as Record<string, unknown>
      const orgs = profile.organizations as Array<{ id?: unknown }> | undefined
      orgId = typeof orgs?.[0]?.id === 'string' ? (orgs[0].id as string) : null
    }
  } catch {
    // best-effort: login still succeeds without the org id
  }
  return { status: 'success', accessToken: token, email, orgId }
}

// ------------------------------------------------------------------ qoder

export interface QoderDeviceFlow {
  verificationUriComplete: string
  userCode: string
  verifier: string
  nonce: string
  machineId: string
}

export async function initiateQoderDeviceFlow(loginUrl: string): Promise<QoderDeviceFlow> {
  const { verifier, challenge } = await generatePkcePair()
  const nonce = crypto.randomUUID()
  const machineId = crypto.randomUUID()
  const params = new URLSearchParams({ challenge, challenge_method: 'S256', machine_id: machineId, nonce })
  return {
    verificationUriComplete: `${loginUrl}?${params.toString()}`,
    userCode: nonce.slice(0, 8).toUpperCase(),
    verifier,
    nonce,
    machineId,
  }
}

export type QoderPollResult =
  | { status: 'pending' }
  | { status: 'success'; accessToken: string; refreshToken: string | null; userId: string; expiresAt: number | null }

export async function pollQoderDeviceToken(
  deviceTokenUrl: string,
  nonce: string,
  verifier: string,
): Promise<QoderPollResult> {
  const url = `${deviceTokenUrl}?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(verifier)}&challenge_method=S256`
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', 'User-Agent': 'Go-http-client/2.0' },
  })
  if (response.status === 202 || response.status === 404) return { status: 'pending' }
  const text = await response.text().catch(() => '')
  if (!response.ok) {
    let message = `Qoder device token poll failed: HTTP ${response.status}`
    try {
      const body = JSON.parse(text) as { message?: unknown }
      if (typeof body.message === 'string' && body.message) message = `Qoder device token poll failed: ${body.message}`
    } catch {
      // keep default
    }
    throw new Error(message)
  }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch (err) {
    throw new Error(`Qoder device token poll: invalid JSON response (${err instanceof Error ? err.message : 'parse error'})`)
  }
  if (typeof body.token !== 'string' || !body.token) {
    throw new Error('Qoder device token poll returned 200 but no token')
  }
  return {
    status: 'success',
    accessToken: body.token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token ? body.refresh_token : null,
    userId: typeof body.user_id === 'string' ? body.user_id : '',
    expiresAt: parseQoderExpiry(body.expires_at, body.expires_in),
  }
}

export async function fetchQoderUserInfo(
  userInfoUrl: string,
  accessToken: string,
): Promise<{ name: string; email: string; organizationId: string }> {
  try {
    const response = await fetch(userInfoUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'Go-http-client/2.0' },
    })
    if (!response.ok) return { name: '', email: '', organizationId: '' }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    return { name: str(body.name) || str(body.username), email: str(body.email), organizationId: str(body.organization_id) }
  } catch {
    return { name: '', email: '', organizationId: '' }
  }
}

/**
 * Upstream expiry hint -> unix-ms. Numeric (or numeric string) = ms epoch,
 * except seconds-scale values (< 1e12, i.e. before Sep 2001 in ms) which are
 * seconds epoch and scaled up — a seconds value read as ms would land in
 * 1970 and instantly expire a valid token. RFC3339 parsed for non-numeric
 * strings; expiresInSeconds >= 0 honored (0 = already expired, no 30-day
 * fabrication); fallback now + 30d.
 */
export function parseQoderExpiry(expiresAt: unknown, expiresInSeconds: unknown): number | null {
  const asMs = (ms: number): number | null => {
    if (!Number.isFinite(ms) || ms <= 0) return null
    return ms < 1e12 ? ms * 1000 : ms
  }
  if (typeof expiresAt === 'number') {
    const normalized = asMs(expiresAt)
    if (normalized !== null) return normalized
  }
  if (typeof expiresAt === 'string') {
    const trimmed = expiresAt.trim()
    if (trimmed) {
      if (/^\d+$/.test(trimmed)) {
        const normalized = asMs(Number.parseInt(trimmed, 10))
        if (normalized !== null) return normalized
      } else {
        const parsed = Date.parse(trimmed)
        if (!Number.isNaN(parsed)) return parsed
      }
    }
  }
  if (typeof expiresInSeconds === 'number' && Number.isFinite(expiresInSeconds) && expiresInSeconds >= 0) {
    return Date.now() + expiresInSeconds * 1000
  }
  return Date.now() + 30 * 24 * 60 * 60 * 1000
}
