// Input validation for auth + admin surfaces. Returns null when valid,
// or a human-readable reason (which doubles as the error message).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const USERNAME_RE = /^[a-z0-9_]{3,24}$/

// Domains commonly used for throwaway signups — blocked to keep the
// no-upfront-tokens economy from being farmed.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  '10minutemail.com',
  'guerrillamail.com',
  'tempmail.com',
  'throwaway.email',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'maildrop.cc',
  'dispostable.com',
  'fakeinbox.com',
  'sharklasers.com',
])

export function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return 'Enter a valid email address.'
  const domain = email.trim().toLowerCase().split('@')[1]
  if (DISPOSABLE_DOMAINS.has(domain)) return 'Disposable email domains are not allowed.'
  if (email.length > 254) return 'Email is too long.'
  return null
}

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string') return 'Username is required.'
  const value = username.trim().toLowerCase()
  if (!USERNAME_RE.test(value)) {
    return 'Username must be 3–24 characters: lowercase letters, numbers, underscores.'
  }
  return null
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters.'
  }
  if (password.length > 200) return 'Password is too long.'
  return null
}

/** Normalizes to the canonical stored form (lowercased/trimmed). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase()
}

/** "Poolside Laguna" -> "poolside-laguna" (collapses runs, strips unsafe chars). */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Absolute http(s) URL. https required outside local development. */
export function validateBaseUrl(baseUrl: unknown, allowHttp: boolean): string | null {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') return 'Base URL is required.'
  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    return 'Base URL must be an absolute URL (e.g. https://api.example.com/v1).'
  }
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    return 'Base URL must use https.'
  }
  // SSRF guard: the base URL is fetched server-side (probe + chat proxy) with
  // the caller/admin-supplied bearer. Reject hosts that resolve to loopback,
  // private, link-local, or metadata space. Skipped when http is allowed (dev)
  // so local Ollama/vLLM endpoints keep working during development.
  if (!allowHttp && isPrivateHost(parsed.hostname)) {
    return 'Base URL must not point at a private or internal address.'
  }
  return null
}

// ---------------------------------------------------------------- SSRF guard

/**
 * Fetch-time guard: re-checks a stored/configured base URL against the SSRF
 * blocklist immediately before the server fetches it. Config-time validation
 * (validateBaseUrl) is the first line; this closes the gap where a URL was
 * stored before the guard existed, or slipped in through another write path.
 *
 * Throws with a human-readable reason when the URL is disallowed. Callers
 * (ping.ts, providers.ts) surface the message as a 400/502 rather than fetch.
 */
export function assertSafeBaseUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Base URL is not a valid absolute URL.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Base URL must use http(s).')
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('Base URL points at a private or internal address.')
  }
}

/**
 * True when the host is an IP or hostname in reserved space. Covers IPv4
 * loopback/private/link-local/multicast/reserved ranges, IPv6 loopback,
 * unspecified, unique-local, and link-local, plus well-known internal
 * hostnames and suffixes. This is defense-in-depth on top of the Workers
 * runtime's own metadata/link-local blocks; it does not defeat DNS rebinding
 * of a public name to a private IP (full protection needs a fetch-time check).
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (host === '') return true

  const exact = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data', 'instance-data.ec2.internal'])
  if (exact.has(host)) return true
  if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.localhost')) return true

  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isPrivateIpv4(host)
  // IPv6 literal
  if (host.includes(':')) return isPrivateIpv6(host)

  return false
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.')
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false
    const value = Number(part)
    if (value > 255) return false
    n = n * 256 + value
  }
  return (
    (n >= 0x00000000 && n <= 0x00ffffff) || // 0.0.0.0/8
    (n >= 0x0a000000 && n <= 0x0affffff) || // 10.0.0.0/8
    (n >= 0x64400000 && n <= 0x647fffff) || // 100.64.0.0/10 CGNAT
    (n >= 0x7f000000 && n <= 0x7fffffff) || // 127.0.0.0/8 loopback
    (n >= 0xa9fe0000 && n <= 0xa9feffff) || // 169.254.0.0/16 link-local / metadata
    (n >= 0xac100000 && n <= 0xac1fffff) || // 172.16.0.0/12
    (n >= 0xc0000000 && n <= 0xc00000ff) || // 192.0.0.0/24
    (n >= 0xc0000200 && n <= 0xc00002ff) || // 192.0.2.0/24 TEST-NET-1
    (n >= 0xc0a80000 && n <= 0xc0a8ffff) || // 192.168.0.0/16
    (n >= 0xc6120000 && n <= 0xc613ffff) || // 198.18.0.0/15 benchmark
    (n >= 0xc6336400 && n <= 0xc63364ff) || // 198.51.100.0/24 TEST-NET-2
    (n >= 0xcb007100 && n <= 0xcb0071ff) || // 203.0.113.0/24 TEST-NET-3
    (n >= 0xe0000000 && n <= 0xefffffff) || // 224.0.0.0/4 multicast
    (n >= 0xf0000000 && n <= 0xffffffff)    // 240.0.0.0/4 reserved
  )
}

function isPrivateIpv6(host: string): boolean {
  const h = host.toLowerCase()
  if (h === '::' || h === '::1') return true
  if (h.startsWith('fc') || h.startsWith('fd')) return true // unique-local fc00::/7
  if (/^fe[89ab]/.test(h)) return true // link-local fe80::/10
  const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) return isPrivateIpv4(mapped[1]) // IPv4-mapped ::ffff:a.b.c.d
  return false
}

export function validateUpstreamModel(model: unknown): string | null {
  if (typeof model !== 'string' || model.trim() === '') return 'Upstream model name is required.'
  if (model.length > 120) return 'Upstream model name is too long.'
  return null
}

export function validateBearer(key: unknown): string | null {
  if (typeof key !== 'string' || key.trim() === '') return 'Bearer key is required.'
  if (key.length > 500) return 'Bearer key is too long.'
  return null
}

/** 'api_key' (static bearer) or 'oauth' (user-supplied OAuth access token). */
export function validateAuthKind(kind: unknown): 'api_key' | 'oauth' | null {
  if (kind === undefined || kind === null || kind === '') return 'api_key'
  if (kind === 'api_key' || kind === 'oauth') return kind
  return null
}

/**
 * User-supplied OAuth access token. Bound looser than a static bearer
 * (providers issue large JWTs) but still capped so the vault can't be used
 * as blob storage.
 */
export function validateOAuthToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.trim() === '') return 'OAuth access token is required.'
  if (token.length > 2048) return 'OAuth access token is too long.'
  return null
}

/** Optional OAuth refresh token (encrypted at rest, never revealable). */
export function validateRefreshToken(token: unknown): string | null {
  if (token === undefined || token === null || token === '') return null
  if (typeof token !== 'string') return 'Refresh token must be a string.'
  if (token.length > 2048) return 'Refresh token is too long.'
  return null
}

/** 'openai' (Chat Completions) or 'codex' (Responses API). Defaults to openai. */
export function validateProtocol(protocol: unknown): 'openai' | 'codex' | null {
  if (protocol === undefined || protocol === null || protocol === '') return 'openai'
  if (protocol === 'openai' || protocol === 'codex') return protocol
  return null
}

/** Default Codex backend endpoint when the user leaves base URL empty. */
export const CODEX_DEFAULT_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'

/**
 * Optional ChatGPT account binding (sent as ChatGPT-Account-ID so several
 * personal Codex accounts never cross-bind). Plain identifier, not a secret.
 */
export function validateAccountId(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return 'Account ID must be a string.'
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 128) return 'Account ID must be 1–128 characters.'
  return trimmed
}

/** Optional unix-epoch-ms expiry for an OAuth access token. */
export function validateExpiryTimestamp(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null
  const ms = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(ms) || ms <= 0) return 'invalid'
  return ms
}

const CAPABILITY_RE = /^[a-z0-9-]{2,24}$/

export function validateCapabilities(capabilities: unknown): string | null {
  if (capabilities === undefined) return null
  if (!Array.isArray(capabilities)) return 'Capabilities must be an array of tags.'
  if (capabilities.length > 8) return 'At most 8 capability tags.'
  for (const tag of capabilities) {
    if (typeof tag !== 'string' || !CAPABILITY_RE.test(tag)) {
      return 'Capability tags must be 2–24 chars: lowercase letters, numbers, hyphens.'
    }
  }
  return null
}

/** 8-char referral code from an unambiguous alphabet. */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const CODE_ALPHABET_SIZE = CODE_ALPHABET.length
// 256 % CODE_ALPHABET_SIZE !== 0, so a naive `byte % size` maps the first few
// characters more often than the rest. Rejection sampling drops the tail of
// the byte range so every character is exactly equiprobable.
const CODE_MAX_UNBIASED = Math.floor(256 / CODE_ALPHABET_SIZE) * CODE_ALPHABET_SIZE

export function generateReferralCode(): string {
  let code = ''
  while (code.length < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    for (const byte of bytes) {
      if (byte >= CODE_MAX_UNBIASED) continue // reject the biased tail
      code += CODE_ALPHABET[byte % CODE_ALPHABET_SIZE]
      if (code.length === 8) break
    }
  }
  return code
}
