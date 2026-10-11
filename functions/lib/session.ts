// Session management: opaque UUID tokens stored in KV, keyed by SHA-256(token)
// so a KV dump can't be replayed. Cookie is HttpOnly + SameSite=Lax (Lax is
// required for the Google OAuth redirect to carry it).

import { newToken, sha256Hex } from './crypto'

export const SESSION_COOKIE = 'freellm_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const SESSION_PREFIX = 'sess:'

export type SessionData = { userId: string; createdAt: number }

async function kvKey(token: string): Promise<string> {
  return `${SESSION_PREFIX}${await sha256Hex(token)}`
}

export function sessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].join('; ')
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!name) continue
    try {
      cookies[name] = decodeURIComponent(value)
    } catch {
      cookies[name] = value
    }
  }
  return cookies
}

export function sessionTokenFromCookies(header: string | null | undefined): string | null {
  return parseCookies(header)[SESSION_COOKIE] ?? null
}

export async function createSession(kv: KVNamespace, userId: string): Promise<{ token: string; cookie: string }> {
  const token = newToken()
  const data: SessionData = { userId, createdAt: Date.now() }
  await kv.put(await kvKey(token), JSON.stringify(data), { expirationTtl: SESSION_TTL_SECONDS })
  return { token, cookie: sessionCookie(token) }
}

export async function getSession(kv: KVNamespace, cookieHeader: string | null | undefined): Promise<SessionData | null> {
  const token = sessionTokenFromCookies(cookieHeader)
  if (!token) return null
  const raw = await kv.get(await kvKey(token))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SessionData
    if (!parsed?.userId) return null
    return parsed
  } catch {
    return null
  }
}

export async function destroySession(kv: KVNamespace, cookieHeader: string | null | undefined): Promise<void> {
  const token = sessionTokenFromCookies(cookieHeader)
  if (!token) return
  await kv.delete(await kvKey(token))
}
