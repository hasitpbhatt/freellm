// Crypto primitives for the Workers runtime (WebCrypto only).
//   * passwords  — PBKDF2-SHA256, 100k iterations, per-user salt
//   * secrets    — AES-256-GCM (provider bearers, BYOK vault)
//   * tokens     — UUIDv4 session tokens; SHA-256 for KV key derivation

const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16
const KEY_BYTES = 32

// ----------------------------------------------------------- base64 helpers

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ------------------------------------------------------------- ids/tokens

export function newId(): string {
  return crypto.randomUUID()
}

export function newToken(): string {
  return crypto.randomUUID()
}

/**
 * Public API token for Bearer auth (used by /v1). The fl_ prefix makes it
 * greppable in secret scanners. Shown to the user exactly once — the store
 * keeps only a SHA-256 hash of it.
 */
export function newApiToken(): string {
  return `fl_${crypto.randomUUID().replace(/-/g, '')}`
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toHex(new Uint8Array(digest))
}

/** Length-independent comparison that does not leak where strings diverge. */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  return constantTimeEqualBytes(encoder.encode(a), encoder.encode(b))
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

// -------------------------------------------------------------- passwords

async function deriveBits(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    material,
    KEY_BYTES * 8,
  )
}

/** Returns `pbkdf2$sha256$<iterations>$<salt-b64>$<hash-b64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const bits = await deriveBits(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')
    if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false
    const iterations = Number(parts[2])
    if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 1_000_000) return false
    const salt = fromBase64(parts[3])
    const expected = fromBase64(parts[4])
    if (salt.length === 0 || expected.length === 0) return false
    const bits = new Uint8Array(await deriveBits(password, salt, iterations))
    return constantTimeEqualBytes(bits, expected)
  } catch {
    return false
  }
}

// --------------------------------------------------------------- secrets

async function importAesKey(keyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyBase64)
  if (raw.length !== KEY_BYTES) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)')
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plaintext: string, keyBase64: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await importAesKey(keyBase64)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { ciphertext: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) }
}

export async function decryptSecret(ciphertext: string, iv: string, keyBase64: string): Promise<string> {
  const key = await importAesKey(keyBase64)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) as BufferSource },
    key,
    fromBase64(ciphertext) as BufferSource,
  )
  return new TextDecoder().decode(plain)
}

/** Last 4 chars of a secret, for display: "••••1a2b". */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return '••••'
  return `••••${plaintext.slice(-4)}`
}

export type EncryptedRow = { key_ciphertext: string; key_iv: string } | { api_key_ciphertext: string; api_key_iv: string }

/** Decrypts and masks a secret from either api_keys (key_*) or model_providers (api_key_*) rows. */
export async function decryptForDisplay(row: EncryptedRow, encryptionKey: string): Promise<string> {
  const ciphertext = 'key_ciphertext' in row ? row.key_ciphertext : row.api_key_ciphertext
  const iv = 'key_iv' in row ? row.key_iv : row.api_key_iv
  try {
    return maskSecret(await decryptSecret(ciphertext, iv, encryptionKey))
  } catch {
    return '•••• (unreadable — check ENCRYPTION_KEY)'
  }
}
