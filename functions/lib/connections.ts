// Connections: the ONE credential store (freellm_connections, 0033).
//
// A connection is a user's own OpenAI-compatible endpoint: a static bearer
// (auth_kind='api_key') or an OAuth grant (auth_kind='oauth'), personal
// (owner_id set) or admin-managed shared (owner_id NULL). Both the native
// /api/chat and the OpenAI-compatible /v1 surface dial through here so the
// decrypt/refresh/header logic lives in exactly one place.

import type { Context } from 'hono'
import type { Bindings, ConnectionRow, ModelRow, Variables } from './types'
import { decryptSecret, encryptSecret } from './crypto'
import { callProvider, type UpstreamConfig } from './providers'
import {
  byokExtraHeaders,
  getOAuthProviderConfig,
  providerClientId,
  providerClientSecret,
  providerIdForVaultRow,
} from './oauth'
import { openByokCodexCall } from './codex'

type Env = { Bindings: Bindings; Variables: Variables }

/**
 * Every personal connection owned by `userId`, newest first. Disabled rows are
 * included: the vault lists them as `disabled` rather than hiding them.
 */
export async function listPersonalConnections(env: Bindings, userId: string): Promise<ConnectionRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM freellm_connections
     WHERE scope = 'personal' AND owner_id = ?
     ORDER BY created_at DESC`,
  )
    .bind(userId)
    .all<ConnectionRow>()
  return results ?? []
}

/** A connection the caller is allowed to use: their own, or a shared one. */
export async function getUsableConnection(
  env: Bindings,
  userId: string,
  id: string,
): Promise<ConnectionRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM freellm_connections
     WHERE id = ? AND active = 1 AND (scope = 'shared' OR owner_id = ?)`,
  )
    .bind(id, userId)
    .first<ConnectionRow>()
  return row ?? null
}

/** True when an OAuth access token is known-expired. */
export function isExpired(conn: ConnectionRow, at: number = Date.now()): boolean {
  return conn.auth_kind === 'oauth' && conn.expires_at != null && conn.expires_at <= at
}

/**
 * The statement that retires what a fresh OAuth connect supersedes, batched
 * with the new row's insert: older live rows for the same account on the same
 * endpoint (account ids compare via COALESCE, so account-less rows collapse
 * exactly as they always have), plus one legacy account-less oauth row when
 * this connect knows its account — a row written before the code-flow
 * providers captured account ids, which used to retire on every reconnect.
 * Different accounts are left alone, which is what lets one provider hold two
 * logins. Rows are never deleted: retired rows stay visible as disabled and
 * are rejected at chat time, an audit trail rather than a silent delete.
 */
export function retireSupersededConnection(
  db: D1Database,
  opts: { now: number; userId: string; baseUrl: string; accountId: string | null; keepId: string },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE freellm_connections SET active = 0, updated_at = ?
       WHERE owner_id = ? AND base_url = ? AND id != ? AND active != 0
         AND (COALESCE(account_id, '') = COALESCE(?, '')
              OR (auth_kind = 'oauth' AND account_id IS NULL AND ? IS NOT NULL))`,
    )
    .bind(opts.now, opts.userId, opts.baseUrl, opts.keepId, opts.accountId, opts.accountId)
}

/**
 * Refreshes an expired OAuth credential and persists the rotation. Mirrors the
 * generic (non-Codex) refresh flow; Codex has its own refresh in lib/codex.ts.
 */
export async function refreshConnectionOAuth(c: Context<Env>, conn: ConnectionRow): Promise<ConnectionRow> {
  if (!c.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not set on this deployment.')
  if (conn.auth_kind !== 'oauth') throw new Error('Not an OAuth connection.')
  if (!conn.refresh_ciphertext || !conn.refresh_iv) {
    throw new Error('OAuth token expired and no refresh token is stored — reconnect it.')
  }

  const providerId = providerIdForVaultRow(conn.base_url, conn.label) ?? conn.provider
  const config = getOAuthProviderConfig(providerId)
  if (!config) throw new Error(`Provider ${providerId} is not configured.`)
  if (!config.refreshable) throw new Error('This account does not support refresh — reconnect it.')

  const refreshToken = await decryptSecret(conn.refresh_ciphertext, conn.refresh_iv, c.env.ENCRYPTION_KEY)
  const clientId = providerClientId(c.env, config)
  const clientSecret = providerClientSecret(c.env, config)

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId ?? '',
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${(await response.text().catch(() => '')).slice(0, 200)}`)
  }

  const tokens = (await response.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!tokens.access_token) throw new Error('Token refresh returned no access_token.')

  const sealedAccess = await encryptSecret(tokens.access_token, c.env.ENCRYPTION_KEY)
  const sealedRefresh = tokens.refresh_token
    ? await encryptSecret(tokens.refresh_token, c.env.ENCRYPTION_KEY)
    : null
  const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : conn.expires_at

  await c.env.DB.prepare(
    `UPDATE freellm_connections
     SET key_ciphertext = ?, key_iv = ?, refresh_ciphertext = COALESCE(?, refresh_ciphertext),
         refresh_iv = COALESCE(?, refresh_iv), expires_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      sealedAccess.ciphertext,
      sealedAccess.iv,
      sealedRefresh?.ciphertext ?? null,
      sealedRefresh?.iv ?? null,
      expiresAt,
      Date.now(),
      conn.id,
    )
    .run()

  return {
    ...conn,
    key_ciphertext: sealedAccess.ciphertext,
    key_iv: sealedAccess.iv,
    refresh_ciphertext: sealedRefresh?.ciphertext ?? conn.refresh_ciphertext,
    refresh_iv: sealedRefresh?.iv ?? conn.refresh_iv,
    expires_at: expiresAt,
  }
}

/**
 * Dials a connection with the caller's credential. Refreshes an expired OAuth
 * token first (Codex refreshes internally). `upstreamModel` overrides the
 * connection's default when supplied (e.g. the `model` field of a /v1 call).
 */
export async function dialConnection(
  c: Context<Env>,
  conn: ConnectionRow,
  opts: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    upstreamModel?: string
    maxTokens?: number
    stream?: boolean
    signal?: AbortSignal
  },
): Promise<Response> {
  if (!c.env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not set on this deployment.')
  const upstreamModel = (opts.upstreamModel || conn.upstream_model || '').trim()
  if (!upstreamModel) throw new Error('No upstream model set for this connection.')

  let working = conn
  if (conn.protocol === 'codex') {
    // openByokCodexCall decrypts, refreshes (and persists), and translates the
    // Responses stream into Chat Completions SSE. It dials `row.upstream_model`,
    // so carry the caller's override across.
    return openByokCodexCall(c.env, { ...working, upstream_model: upstreamModel }, opts.messages, {
      signal: opts.signal,
    })
  }

  if (isExpired(working)) {
    working = await refreshConnectionOAuth(c, working)
  }
  const apiKey = await decryptSecret(working.key_ciphertext, working.key_iv, c.env.ENCRYPTION_KEY)

  const candidate: UpstreamConfig = {
    id: `connection:${working.id}`,
    base_url: working.base_url,
    upstream_model: upstreamModel,
  }
  const call = await callProvider(candidate, apiKey, opts.messages, {
    maxTokens: opts.maxTokens ?? 8192,
    stream: opts.stream ?? true,
    headers: byokExtraHeaders(working.base_url, working.account_id),
  })
  return call.response
}

/** The masked, client-safe shape of a connection row. */
export function publicConnection(row: ConnectionRow) {
  return {
    id: row.id,
    scope: row.scope,
    provider: row.provider,
    label: row.label,
    base_url: row.base_url,
    upstream_model: row.upstream_model,
    auth_kind: row.auth_kind,
    protocol: row.protocol,
    account_id: row.account_id ?? null,
    has_refresh_token: row.refresh_ciphertext != null,
    expires_at: row.expires_at ?? null,
    expired: isExpired(row),
    status: row.active === 0 ? ('disabled' as const) : row.status,
    last_checked_at: row.last_checked_at,
    last_error: row.last_error,
    avg_latency_ms: row.avg_latency_ms,
    messages_served: row.messages_served,
    created_at: row.created_at,
  }
}

/**
 * The synthetic, zero-cost `ModelRow` used to meter a connection call. Both the
 * native /api/chat and the OpenAI-compatible /v1 surface settle through it, so
 * it lives here rather than being rebuilt (and drifting) in each route.
 */
export function connectionSettleModel(connectionId: string, upstreamModel: string): ModelRow {
  return {
    id: `connection:${connectionId}`,
    slug: upstreamModel || 'byok',
    label: upstreamModel || 'Your connection',
    description: null,
    capabilities: '',
    context_window: null,
    max_output_tokens: 8192,
    flat_rate_credits: 0,
    routing: 'failover',
    access_tier: 'free',
    scoped_only: 0,
    active: 1,
    sort_order: 0,
    created_at: Date.now(),
    updated_at: Date.now(),
  }
}
