import { connect } from 'cloudflare:sockets'
import { decryptSecret, encryptSecret } from './crypto'
import type { Bindings } from './types'
import type { ProxyRow } from './types'

export type ProxyPublic = {
  id: string
  label: string
  url: string
  username: string | null
  has_password: boolean
  status: string
  enabled: number
  cooldown_until: number | null
  last_checked_at: number | null
  last_error: string | null
  created_at: number
  updated_at: number
}

function now() {
  return Date.now()
}

function toPublic(row: ProxyRow): ProxyPublic {
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    username: row.username,
    has_password: Boolean(row.password_ciphertext && row.password_iv),
    status: row.status,
    enabled: row.enabled,
    cooldown_until: row.cooldown_until,
    last_checked_at: row.last_checked_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function audit(db: D1Database, actorId: string | null, action: string, meta: any) {
  try {
    const id = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO freellm_admin_audit_log (id, admin_id, action, target_type, target_id, justification, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, actorId, action, 'upstream_provider', meta?.id || null, JSON.stringify(meta), null, null, now())
      .run()
  } catch {}
}

export async function listProxies(db: D1Database): Promise<ProxyPublic[]> {
  const res = await db.prepare('SELECT * FROM freellm_proxies ORDER BY created_at ASC').all<ProxyRow>()
  return (res.results || []).map(toPublic)
}

export async function getProxyRow(db: D1Database, id: string): Promise<ProxyRow | null> {
  const row = await db.prepare('SELECT * FROM freellm_proxies WHERE id = ?').bind(id).first<ProxyRow>()
  return row || null
}

export async function createProxy(
  db: D1Database,
  env: Bindings,
  actorId: string | null,
  input: { label: string; url: string; username?: string | null; password?: string | null },
): Promise<ProxyPublic> {
  const id = crypto.randomUUID()
  const ts = now()
  let pwCipher: string | null = null
  let pwIv: string | null = null
  if (input.password && env.ENCRYPTION_KEY) {
    const enc = await encryptSecret(input.password, env.ENCRYPTION_KEY)
    pwCipher = enc.ciphertext
    pwIv = enc.iv
  }
  await db
    .prepare(
      `INSERT INTO freellm_proxies (id, label, url, username, password_ciphertext, password_iv, status, cooldown_until, last_checked_at, last_error, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'unknown', NULL, NULL, NULL, 1, ?, ?)`,
    )
    .bind(id, input.label, input.url, input.username || null, pwCipher, pwIv, ts, ts)
    .run()
  await audit(db, actorId, 'proxy.create', { id, label: input.label })
  const row = await getProxyRow(db, id)
  return toPublic(row!)
}

export async function updateProxy(
  db: D1Database,
  env: Bindings,
  actorId: string | null,
  id: string,
  input: { label?: string; url?: string; username?: string | null; password?: string | null; enabled?: number },
): Promise<ProxyPublic> {
  const existing = await getProxyRow(db, id)
  if (!existing) throw new Error('Proxy not found')
  const ts = now()
  const sets: string[] = ['updated_at = ?']
  const binds: any[] = [ts]
  if (input.label !== undefined) {
    sets.push('label = ?')
    binds.push(input.label)
  }
  if (input.url !== undefined) {
    sets.push('url = ?')
    binds.push(input.url)
  }
  if (input.username !== undefined) {
    sets.push('username = ?')
    binds.push(input.username)
  }
  if (input.enabled !== undefined) {
    sets.push('enabled = ?')
    binds.push(input.enabled)
  }
  if (input.password && env.ENCRYPTION_KEY) {
    const enc = await encryptSecret(input.password, env.ENCRYPTION_KEY)
    sets.push('password_ciphertext = ?')
    sets.push('password_iv = ?')
    binds.push(enc.ciphertext)
    binds.push(enc.iv)
  }
  binds.push(id)
  await db.prepare(`UPDATE freellm_proxies SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()
  await audit(db, actorId, 'proxy.update', { id })
  const row = await getProxyRow(db, id)
  return toPublic(row!)
}

export async function deleteProxy(db: D1Database, actorId: string | null, id: string): Promise<void> {
  await db.prepare('DELETE FROM freellm_proxies WHERE id = ?').bind(id).run()
  await audit(db, actorId, 'proxy.delete', { id })
}

export async function revealProxyPassword(db: D1Database, env: Bindings, actorId: string | null, id: string): Promise<string | null> {
  const row = await getProxyRow(db, id)
  if (!row || !row.password_ciphertext || !row.password_iv || !env.ENCRYPTION_KEY) return null
  const pw = await decryptSecret(row.password_ciphertext, row.password_iv, env.ENCRYPTION_KEY)
  await audit(db, actorId, 'proxy.reveal', { id })
  return pw
}

export async function markProxyCooldown(db: D1Database, id: string, ms: number) {
  const until = ms <= 0 ? now() : now() + ms
  await db
    .prepare('UPDATE freellm_proxies SET cooldown_until = ?, status = CASE WHEN status = ? THEN ? ELSE status END, updated_at = ? WHERE id = ?')
    .bind(until, 'live', 'slow', now(), id)
    .run()
}

export async function clearProxyCooldown(db: D1Database, id: string) {
  await db.prepare('UPDATE freellm_proxies SET cooldown_until = NULL, updated_at = ? WHERE id = ?').bind(now(), id).run()
}

export async function pickProxy(db: D1Database): Promise<ProxyRow | null> {
  const ts = now()
  const res = await db
    .prepare(
      `SELECT * FROM freellm_proxies 
       WHERE enabled = 1 
         AND (cooldown_until IS NULL OR cooldown_until < ?)
       ORDER BY RANDOM()`,
    )
    .bind(ts)
    .all<ProxyRow>()
  const rows = res.results || []
  if (rows.length === 0) return null
  return rows[0]
}

function parseProxyUrl(url: string): { host: string; port: number } {
  try {
    if (url.includes('://')) {
      const u = new URL(url)
      return { host: u.hostname, port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80) }
    }
    const [h, p] = url.split(':')
    return { host: h, port: p ? Number(p) : 8080 }
  } catch {
    throw new Error('Invalid proxy URL')
  }
}

export async function testProxy(
  db: D1Database,
  _env: Bindings,
  actorId: string | null,
  id: string,
): Promise<{ ok: boolean; status: string; latencyMs: number | null; error?: string }> {
  const row = await getProxyRow(db, id)
  if (!row) throw new Error('Proxy not found')
  const start = now()
  try {
    const { host, port } = parseProxyUrl(row.url)
    const connectPromise = connect({ hostname: host, port })
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('proxy connect timeout')), 10000))
    const sock = (await Promise.race([connectPromise, timeoutPromise])) as any
    const writer = sock.writable.getWriter()
    const req = `CONNECT httpbin.org:443 HTTP/1.1\r\nHost: httpbin.org:443\r\n\r\n`
    await writer.write(new TextEncoder().encode(req))
    const reader = sock.readable.getReader()
    const { value } = await reader.read()
    const resp = new TextDecoder().decode(value || new Uint8Array())
    await sock.close().catch(() => {})
    const latencyMs = now() - start
    if (resp.includes('200 Connection established') || resp.includes('200 OK')) {
      await db
        .prepare('UPDATE freellm_proxies SET status = ?, last_checked_at = ?, last_error = NULL, cooldown_until = NULL, updated_at = ? WHERE id = ?')
        .bind('live', now(), now(), id)
        .run()
      await audit(db, actorId, 'proxy.test', { id, ok: true, latencyMs })
      return { ok: true, status: 'live', latencyMs }
    }
    await db
      .prepare('UPDATE freellm_proxies SET status = ?, last_checked_at = ?, last_error = ?, updated_at = ? WHERE id = ?')
      .bind('down', now(), resp.slice(0, 200), now(), id)
      .run()
    await audit(db, actorId, 'proxy.test', { id, ok: false, latencyMs })
    return { ok: false, status: 'down', latencyMs, error: resp.slice(0, 200) }
  } catch (e: any) {
    const latencyMs = now() - start
    await db
      .prepare('UPDATE freellm_proxies SET status = ?, last_checked_at = ?, last_error = ?, updated_at = ? WHERE id = ?')
      .bind('down', now(), String(e).slice(0, 200), now(), id)
      .run()
    await audit(db, actorId, 'proxy.test', { id, ok: false, latencyMs })
    return { ok: false, status: 'down', latencyMs, error: String(e) }
  }
}

export async function withProxyRetry<T>(
  db: D1Database,
  fn: (useProxy: boolean, proxyRow: ProxyRow | null) => Promise<T>,
  isRetryableError: (e: any) => boolean,
): Promise<T> {
  try {
    return await fn(false, null)
  } catch (e) {
    if (!isRetryableError(e)) throw e
    const proxy = await pickProxy(db)
    if (!proxy) throw e
    try {
      const result = await fn(true, proxy)
      await clearProxyCooldown(db, proxy.id)
      return result
    } catch (e2) {
      await markProxyCooldown(db, proxy.id, 60000)
      throw e
    }
  }
}
