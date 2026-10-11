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
  return null
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

export function generateReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  let code = ''
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return code
}
