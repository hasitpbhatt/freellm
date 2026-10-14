import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import { createTestDb } from './helpers/db'
import {
  validateAuthKind,
  validateExpiryTimestamp,
  validateOAuthToken,
  validateRefreshToken,
} from '../functions/lib/validate'

let db: D1Database
let dispose: () => Promise<void>

before(async () => {
  const created = await createTestDb()
  db = created.db
  dispose = created.dispose
})

after(async () => {
  if (dispose) await dispose()
})

test('migrations: BYOK vault supports per-user OAuth accounts', async () => {
  const columns = await db.prepare('PRAGMA table_info(freellm_api_keys)').all<{ name: string }>()
  const names = new Set(columns.results.map((column) => column.name))
  for (const name of ['auth_kind', 'protocol', 'account_id', 'refresh_ciphertext', 'refresh_iv', 'expires_at']) {
    assert.equal(names.has(name), true, `missing freellm_api_keys.${name}`)
  }

  // Legacy rows default to static-bearer kind.
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_users (id, email, username, password_hash, referral_code,
                                   balance_credits, role, email_verified, created_at, updated_at)
       VALUES ('oauth_user', 'oauth@example.com', 'oauthuser', NULL, 'oauthcode1', 0, 'user', 1, ?, ?)`,
    )
    .bind(now, now)
    .run()
  await db
    .prepare(
      `INSERT INTO freellm_api_keys (id, user_id, provider, label, base_url, upstream_model,
                              key_ciphertext, key_iv, status, last_checked_at, last_error,
                              avg_latency_ms, active, messages_served, created_at, updated_at)
       VALUES ('legacy_key', 'oauth_user', 'byok', 'Legacy', 'https://api.example.com/v1', 'm',
               'c', 'iv', 'unknown', NULL, NULL, NULL, 1, 0, ?, ?)`,
    )
    .bind(now, now)
    .run()
  const legacy = await db
    .prepare('SELECT auth_kind FROM freellm_api_keys WHERE id = ?')
    .bind('legacy_key')
    .first<{ auth_kind: string }>()
  assert.equal(legacy?.auth_kind, 'api_key')

  // OAuth account rows store kind + encrypted refresh + expiry.
  await db
    .prepare(
      `INSERT INTO freellm_api_keys (id, user_id, provider, label, base_url, upstream_model,
                              key_ciphertext, key_iv, auth_kind, refresh_ciphertext, refresh_iv, expires_at,
                              status, last_checked_at, last_error,
                              avg_latency_ms, active, messages_served, created_at, updated_at)
       VALUES ('oauth_key', 'oauth_user', 'byok', 'My Gemini', 'https://api.example.com/v1', 'gemini-2.5-flash',
               'c', 'iv', 'oauth', 'rc', 'riv', ?, 'unknown', NULL, NULL, NULL, 1, 0, ?, ?)`,
    )
    .bind(now + 3_600_000, now, now)
    .run()
  const oauth = await db
    .prepare('SELECT auth_kind, refresh_ciphertext, refresh_iv, expires_at FROM freellm_api_keys WHERE id = ?')
    .bind('oauth_key')
    .first<{ auth_kind: string; refresh_ciphertext: string | null; refresh_iv: string | null; expires_at: number | null }>()
  assert.equal(oauth?.auth_kind, 'oauth')
  assert.equal(oauth?.refresh_ciphertext, 'rc')
  assert.equal(oauth?.refresh_iv, 'riv')
  assert.equal(oauth?.expires_at, now + 3_600_000)

  // The kind CHECK rejects anything outside the two supported kinds.
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO freellm_api_keys (id, user_id, provider, label, base_url, upstream_model,
                                key_ciphertext, key_iv, auth_kind, status, active, messages_served, created_at, updated_at)
         VALUES ('bad_kind', 'oauth_user', 'byok', 'Bad', 'https://api.example.com/v1', 'm',
                 'c', 'iv', 'shared_pool', 'unknown', 1, 0, ?, ?)`,
      )
      .bind(now, now)
      .run(),
    /CHECK constraint failed/,
  )

  // A user can hold several accounts; each row stays individually owned.
  const count = await db
    .prepare('SELECT COUNT(*) AS n FROM freellm_api_keys WHERE user_id = ?')
    .bind('oauth_user')
    .first<{ n: number }>()
  assert.equal(count?.n, 2)
})

test('vault reads are owner-scoped and honour OAuth expiry (the /v1 + /api/chat BYOK contract)', async () => {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_users (id, email, username, password_hash, referral_code,
                                   balance_credits, role, email_verified, created_at, updated_at)
       VALUES ('oauth_intruder', 'intruder@example.com', 'intruder', NULL, 'intruderc1', 0, 'user', 1, ?, ?)`,
    )
    .bind(now, now)
    .run()
  await db
    .prepare(
      `INSERT INTO freellm_api_keys (id, user_id, provider, label, base_url, upstream_model,
                              key_ciphertext, key_iv, auth_kind, refresh_ciphertext, refresh_iv, expires_at,
                              status, active, messages_served, created_at, updated_at)
       VALUES ('oauth_stale', 'oauth_user', 'byok', 'Stale Gemini', 'https://api.example.com/v1', 'gemini-2.5-flash',
               'c', 'iv', 'oauth', NULL, NULL, ?, 'unknown', 1, 0, ?, ?)`,
    )
    .bind(now - 1_000, now, now)
    .run()

  // The exact lookup both chat surfaces use: id + owner.
  const owned = await db
    .prepare('SELECT id FROM freellm_api_keys WHERE id = ? AND user_id = ?')
    .bind('oauth_key', 'oauth_user')
    .first<{ id: string }>()
  assert.equal(owned?.id, 'oauth_key')
  const foreign = await db
    .prepare('SELECT id FROM freellm_api_keys WHERE id = ? AND user_id = ?')
    .bind('oauth_key', 'oauth_intruder')
    .first()
  assert.equal(foreign, null, 'another user must never resolve your vault row')

  // The expiry gate both chat surfaces apply before dialing (COALESCE so
  // pre-migration rows without the column behave as static bearers).
  const stale = await db
    .prepare("SELECT id FROM freellm_api_keys WHERE id = ? AND COALESCE(auth_kind, 'api_key') = 'oauth' AND expires_at IS NOT NULL AND expires_at <= ?")
    .bind('oauth_stale', now)
    .first<{ id: string }>()
  assert.equal(stale?.id, 'oauth_stale')
  const fresh = await db
    .prepare("SELECT id FROM freellm_api_keys WHERE id = ? AND COALESCE(auth_kind, 'api_key') = 'oauth' AND expires_at IS NOT NULL AND expires_at <= ?")
    .bind('oauth_key', now)
    .first()
  assert.equal(fresh, null, 'an unexpired OAuth account must pass the gate')
})

test('validateAuthKind: defaults to api_key, accepts oauth, rejects the rest', () => {
  assert.equal(validateAuthKind(undefined), 'api_key')
  assert.equal(validateAuthKind(''), 'api_key')
  assert.equal(validateAuthKind('api_key'), 'api_key')
  assert.equal(validateAuthKind('oauth'), 'oauth')
  assert.equal(validateAuthKind('shared'), null)
  assert.equal(validateAuthKind('pool'), null)
})

test('validateOAuthToken / validateRefreshToken: bounded, refresh optional', () => {
  assert.equal(validateOAuthToken('ya29.abc'), null)
  assert.equal(validateOAuthToken(''), 'OAuth access token is required.')
  assert.equal(validateOAuthToken('x'.repeat(2049)), 'OAuth access token is too long.')
  assert.equal(validateRefreshToken(undefined), null)
  assert.equal(validateRefreshToken(''), null)
  assert.equal(validateRefreshToken('1//refresh'), null)
  assert.equal(validateRefreshToken('x'.repeat(2049)), 'Refresh token is too long.')
})

test('validateExpiryTimestamp: epoch-ms or bust', () => {
  assert.equal(validateExpiryTimestamp(undefined), null)
  assert.equal(validateExpiryTimestamp(''), null)
  assert.equal(validateExpiryTimestamp(1767225600000), 1767225600000)
  assert.equal(validateExpiryTimestamp('1767225600000'), 1767225600000)
  assert.equal(validateExpiryTimestamp(0), 'invalid')
  assert.equal(validateExpiryTimestamp(-5), 'invalid')
  assert.equal(validateExpiryTimestamp(1.5), 'invalid')
  assert.equal(validateExpiryTimestamp('soon'), 'invalid')
})

test('migrations: upstream models carry an editable streaming flag', async () => {
  const columns = await db.prepare('PRAGMA table_info(freellm_upstream_models)').all<{ name: string }>()
  assert.equal(
    columns.results.some((column) => column.name === 'supports_streaming'),
    true,
  )

  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_upstream_providers (id, label, base_url, status, cooldown_base_ms, created_at, updated_at)
       VALUES ('streamprov', 'Stream Provider', 'https://api.example.com/v1', 'live', NULL, ?, ?)`,
    )
    .bind(now, now)
    .run()
  // Omitted flag defaults to streaming-capable.
  await db
    .prepare('INSERT INTO freellm_upstream_models (upstream_provider_id, upstream_model) VALUES (?, ?)')
    .bind('streamprov', 'defaults-stream')
    .run()
  await db
    .prepare(
      'INSERT INTO freellm_upstream_models (upstream_provider_id, upstream_model, supports_streaming) VALUES (?, ?, ?)',
    )
    .bind('streamprov', 'gemini-2.5-flash', 0)
    .run()

  const fallback = await db
    .prepare('SELECT supports_streaming FROM freellm_upstream_models WHERE upstream_model = ?')
    .bind('defaults-stream')
    .first<{ supports_streaming: number }>()
  assert.equal(fallback?.supports_streaming, 1)

  // The PATCH-equivalent update flips one model without touching the other.
  const updated = await db
    .prepare('UPDATE freellm_upstream_models SET supports_streaming = ? WHERE upstream_provider_id = ? AND upstream_model = ?')
    .bind(1, 'streamprov', 'gemini-2.5-flash')
    .run()
  assert.equal(updated.meta?.changes ?? 0, 1)
  const missing = await db
    .prepare('UPDATE freellm_upstream_models SET supports_streaming = ? WHERE upstream_provider_id = ? AND upstream_model = ?')
    .bind(1, 'streamprov', 'nope')
    .run()
  assert.equal(missing.meta?.changes ?? 0, 0)
})
