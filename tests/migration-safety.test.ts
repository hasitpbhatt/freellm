// Regression test for the Oct 2026 production incident: migration 0011 rebuilt
// freellm_models with DROP TABLE, and D1's enforced ON DELETE CASCADE wiped
// every row in freellm_model_providers. Migrations that rebuild a parent
// table must back up and restore the child. This test applies migrations in
// two stages around seeded rows and proves nothing is lost.

import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Miniflare } from 'miniflare'
import type { D1Database } from '@cloudflare/workers-types'

const migrationsDir = join(__dirname, '..', '..', 'migrations')

let db: D1Database
let _dispose: () => Promise<void>

function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    // See tests/helpers/db.ts: a trailing CR defeats the `--` strip on CRLF
    // checkouts and newer workerd builds reject comment-only statements.
    .map((line) => line.replace(/\r$/, '').replace(/--.*$/, ''))
    .join('\n')
  return withoutComments
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !/^PRAGMA\b/i.test(chunk))
}

async function apply(names: string[]): Promise<void> {
  for (const name of names) {
    const sql = readFileSync(join(migrationsDir, name), 'utf8')
    const statements = splitStatements(sql).map((chunk) => db.prepare(chunk))
    if (statements.length > 0) await db.batch(statements)
  }
}

function ordered(names: string[]): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => names.some((n) => name.startsWith(n)))
}

let mf: Miniflare | null = null

async function freshDb(): Promise<D1Database> {
  if (mf) await mf.dispose()
  mf = new Miniflare({
    script: 'export default { fetch() { return new Response("ok") } }',
    modules: true,
    compatibilityDate: '2026-05-03',
    d1Databases: { DB: 'migration-safety-db' },
  })
  return (await mf.getD1Database('DB')) as unknown as D1Database
}

after(async () => {
  if (mf) await mf.dispose()
})

test('parent-table rebuild preserves provider configs and billing history shape', async () => {
  db = await freshDb()
  await apply(ordered(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010']))

  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
       VALUES ('m1', 'm1', 'M1', '[]', 2000, 'failover', 1, 0, ?, ?)`,
    )
    .bind(now, now)
    .run()
  await db
    .prepare(
      `INSERT INTO freellm_model_providers (id, model_id, label, base_url, upstream_model, api_key_ciphertext, api_key_iv,
                                            status, priority, active, messages_served, consecutive_failures, cooldown_until, created_at, updated_at)
       VALUES ('p1', 'm1', 'pool-key-1', 'https://x.example/v1', 'm', 'cipher', 'iv', 'live', 0, 1, 7, 0, NULL, ?, ?)`,
    )
    .bind(now, now)
    .run()
  const before = await db.prepare('SELECT * FROM freellm_model_providers WHERE id = ?').bind('p1').first()

  await apply(ordered(['0011', '0012']))

  const models = await db.prepare('SELECT COUNT(*) AS n FROM freellm_models').first<{ n: number }>()
  const providers = await db.prepare('SELECT COUNT(*) AS n FROM freellm_model_providers').first<{ n: number }>()
  assert.equal(models?.n, 1)
  assert.equal(providers?.n, 1)

  const after = await db.prepare('SELECT * FROM freellm_model_providers WHERE id = ?').bind('p1').first()
  assert.deepEqual(after, { ...before, cooldown_until: before?.cooldown_until ?? null })

  // The widened CHECK actually accepts the new strategy, and tier defaults land.
  await db.prepare(`UPDATE freellm_models SET routing = 'latency_weighted' WHERE id = 'm1'`).run()
  const tiered = await db
    .prepare('SELECT routing, access_tier FROM freellm_models WHERE id = ?')
    .bind('m1')
    .first<{ routing: string; access_tier: string }>()
  assert.deepEqual(tiered, { routing: 'latency_weighted', access_tier: 'free' })
})

test('migration 0025: upstream key pool canonicalization preserves configs and keys', async () => {
  db = await freshDb()
  // Apply up to 0024 (before key pool migration)
  await apply(ordered(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010',
                        '0011', '0012', '0013', '0014', '0015', '0016', '0017', '0018', '0019', '0020',
                        '0021', '0022', '0023', '0024']))

  const now = Date.now()

  // Create the model first (FK requirement)
  await db.prepare(
    `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
     VALUES ('m1', 'm1', 'M1', '[]', 2000, 'failover', 1, 0, ?, ?)`,
  ).bind(now, now).run()

  // Create two providers with SAME base_url (duplicates to be merged)
  await db.prepare(
    `INSERT INTO freellm_upstream_providers (id, label, base_url, api_key_ciphertext, api_key_iv, status, cooldown_base_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'live', NULL, ?, ?)`,
  ).bind('prov-a', 'Provider A', 'https://api.example.com/v1', 'cipher-a', 'iv-a', now, now).run()

  await db.prepare(
    `INSERT INTO freellm_upstream_providers (id, label, base_url, api_key_ciphertext, api_key_iv, status, cooldown_base_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'slow', NULL, ?, ?)`,
  ).bind('prov-b', 'Provider B', 'https://api.example.com/v1', 'cipher-b', 'iv-b', now + 1000, now + 1000).run()

  // Upstream models on both
  await db.prepare(
    `INSERT INTO freellm_upstream_models (upstream_provider_id, upstream_model, capabilities, context_window, max_output_tokens)
     VALUES (?, 'model-x', '[]', 8192, 4096)`,
  ).bind('prov-a').run()
  await db.prepare(
    `INSERT INTO freellm_upstream_models (upstream_provider_id, upstream_model, capabilities, context_window, max_output_tokens)
     VALUES (?, 'model-y', '[]', 16384, 8192)`,
  ).bind('prov-b').run()

  // Model alias configs pointing to both providers (should dedupe)
  await db.prepare(
    `INSERT INTO freellm_model_providers (id, model_id, upstream_provider_id, upstream_model, priority, active, messages_served, created_at, updated_at)
     VALUES (?, 'm1', 'prov-a', 'model-x', 0, 1, 5, ?, ?)`,
  ).bind('mp-a', now, now).run()
  await db.prepare(
    `INSERT INTO freellm_model_providers (id, model_id, upstream_provider_id, upstream_model, priority, active, messages_served, created_at, updated_at)
     VALUES (?, 'm1', 'prov-b', 'model-x', 1, 1, 3, ?, ?)`,
  ).bind('mp-b', now, now).run()

  // Apply 0025 (key pool + canonicalization)
  await apply(ordered(['0025']))

  // After: only ONE provider per base_url should remain
  const upAfter = await db.prepare('SELECT * FROM freellm_upstream_providers ORDER BY id').all()
  assert.equal(upAfter.results.length, 1, 'duplicate providers merged into one canonical')
  const canonical = upAfter.results[0]
  assert.equal(canonical.base_url, 'https://api.example.com/v1')
  assert.equal(canonical.status, 'live', 'best status (live > slow) wins')

  // Both upstream models should exist on the canonical provider
  const modelsAfter = await db.prepare('SELECT upstream_model FROM freellm_upstream_models WHERE upstream_provider_id = ? ORDER BY upstream_model').bind(canonical.id).all()
  assert.deepEqual(modelsAfter.results.map(r => r.upstream_model).sort(), ['model-x', 'model-y'])

  // Model providers: duplicate (same model_id + upstream_model + base_url) should be collapsed
  const mpAfter = await db.prepare('SELECT * FROM freellm_model_providers ORDER BY id').all()
  // prov-a's config (priority 0) should survive, messages_served summed (5 + 3 = 8)
  const survivor = mpAfter.results.find(r => r.upstream_model === 'model-x')
  assert.ok(survivor, 'one config survives for model-x on this base_url')
  assert.equal(survivor?.messages_served, 8, 'messages_served summed from both duplicates')

  // Keys: both original keys should be moved to canonical provider
  const keysAfter = await db.prepare('SELECT * FROM freellm_upstream_keys ORDER BY id').all()
  assert.equal(keysAfter.results.length, 2, 'both keys preserved and repointed to canonical')

  // Backup tables exist
  const backups = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_0025_backup'`
  ).all()
  assert.equal(backups.results.length, 3, 'three backup tables created for rollback safety')
})

test('migration 0026: promo expiry ledger rebuild preserves ledger rows', async () => {
  db = await freshDb()
  // Apply up to 0025
  await apply(ordered(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010',
                        '0011', '0012', '0013', '0014', '0015', '0016', '0017', '0018', '0019', '0020',
                        '0021', '0022', '0023', '0024', '0025']))

  const now = Date.now()
  const userId = 'user_mig26'

  await db.prepare(
    `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, created_at, updated_at)
     VALUES (?, 'u@test.com', 'usermig', NULL, 'code', 0, 'user', 1, ?, ?)`,
  ).bind(userId, now, now).run()

  // Seed some ledger rows
  await db.prepare(
    `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
     VALUES (?, ?, 5000, 'signup_bonus', '{}', ?)`,
  ).bind('l1', userId, now).run()
  await db.prepare(
    `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
     VALUES (?, ?, -1000, 'chat_spend', '{}', ?)`,
  ).bind('l2', userId, now + 1000).run()

  const ledgerBefore = await db.prepare('SELECT * FROM freellm_credit_ledger WHERE user_id = ? ORDER BY created_at').bind(userId).all()

  // Apply 0026 (ledger rebuild with new reason)
  await apply(ordered(['0026']))

  const ledgerAfter = await db.prepare('SELECT * FROM freellm_credit_ledger WHERE user_id = ? ORDER BY created_at').bind(userId).all()

  // All original rows preserved
  assert.equal(ledgerAfter.results.length, ledgerBefore.results.length, 'ledger row count unchanged after rebuild')
  for (let i = 0; i < ledgerBefore.results.length; i++) {
    const before = ledgerBefore.results[i]
    const after = ledgerAfter.results[i]
    assert.equal(after.id, before.id)
    assert.equal(after.user_id, before.user_id)
    assert.equal(after.delta, before.delta)
    assert.equal(after.reason, before.reason)
    assert.equal(after.meta, before.meta)
    assert.equal(after.created_at, before.created_at)
  }

  // New reason 'promo_expiry' is now allowed by CHECK constraint
  await db.prepare(
    `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
     VALUES ('l3', ?, -500, 'promo_expiry', '{}', ?)`,
  ).bind(userId, now + 2000).run()
  const newRow = await db.prepare('SELECT * FROM freellm_credit_ledger WHERE id = ?').bind('l3').first()
  assert.ok(newRow, 'new promo_expiry reason accepted')
  assert.equal(newRow.reason, 'promo_expiry')
})

test('migration 0032: admin grants table lands and grant_expiry ledger rebuild preserves rows', async () => {
  db = await freshDb()
  // Apply up to 0031
  await apply(ordered(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010',
                        '0011', '0012', '0013', '0014', '0015', '0016', '0017', '0018', '0019', '0020',
                        '0021', '0022', '0023', '0024', '0025', '0026', '0027', '0028', '0029', '0030',
                        '0031']))

  const now = Date.now()
  const userId = 'user_mig32'

  await db.prepare(
    `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, created_at, updated_at)
     VALUES (?, 'u32@test.com', 'usermig32', NULL, 'code32', 0, 'user', 1, ?, ?)`,
  ).bind(userId, now, now).run()

  await db.prepare(
    `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
     VALUES (?, ?, 5000, 'promo_expiry', '{}', ?)`,
  ).bind('l32a', userId, now).run()

  // Apply 0032 (admin grants table + ledger rebuild with grant_expiry reason)
  await apply(ordered(['0032']))

  const ledgerAfter = await db.prepare('SELECT * FROM freellm_credit_ledger WHERE user_id = ? ORDER BY created_at').bind(userId).all()
  assert.equal(ledgerAfter.results.length, 1, 'ledger row count unchanged after rebuild')
  assert.equal(ledgerAfter.results[0].reason, 'promo_expiry')

  const cols = await db.prepare(`PRAGMA table_info(freellm_admin_grants)`).all<{ name: string }>()
  const names = new Set(cols.results.map((c) => c.name))
  for (const name of ['id', 'user_id', 'credits', 'expires_at', 'expired_at', 'note', 'created_by', 'created_at']) {
    assert.ok(names.has(name), `freellm_admin_grants has ${name}`)
  }

  // New reason 'grant_expiry' is now allowed by CHECK constraint
  await db.prepare(
    `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
     VALUES ('l32b', ?, -500, 'grant_expiry', '{}', ?)`,
  ).bind(userId, now + 1000).run()
  const newRow = await db.prepare('SELECT * FROM freellm_credit_ledger WHERE id = ?').bind('l32b').first()
  assert.ok(newRow, 'new grant_expiry reason accepted')
  assert.equal(newRow.reason, 'grant_expiry')
})

test('migration 0027: provider key pool finalization drops legacy columns', async () => {
  db = await freshDb()
  // Apply up to 0026
  await apply(ordered(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010',
                        '0011', '0012', '0013', '0014', '0015', '0016', '0017', '0018', '0019', '0020',
                        '0021', '0022', '0023', '0024', '0025', '0026']))

  const now = Date.now()

  // Provider with legacy key columns AND a key pool row
  await db.prepare(
    `INSERT INTO freellm_upstream_providers (id, label, base_url, api_key_ciphertext, api_key_iv, status, cooldown_base_ms, created_at, updated_at)
     VALUES (?, ?, ?, 'legacy-cipher', 'legacy-iv', 'live', NULL, ?, ?)`,
  ).bind('prov-legacy', 'Legacy Provider', 'https://legacy.example/v1', now, now).run()

  // Provider with legacy key columns but NO key pool row (should get one backfilled)
  await db.prepare(
    `INSERT INTO freellm_upstream_providers (id, label, base_url, api_key_ciphertext, api_key_iv, status, cooldown_base_ms, created_at, updated_at)
     VALUES (?, ?, ?, 'orphan-cipher', 'orphan-iv', 'live', NULL, ?, ?)`,
  ).bind('prov-orphan', 'Orphan Provider', 'https://orphan.example/v1', now, now).run()

  const colsBefore = await db.prepare(`PRAGMA table_info(freellm_upstream_providers)`).all<{ name: string }>()
  const hasCipherBefore = colsBefore.results.some((c) => c.name === 'api_key_ciphertext')
  const hasIvBefore = colsBefore.results.some((c) => c.name === 'api_key_iv')
  assert.ok(hasCipherBefore && hasIvBefore, 'legacy columns exist before 0027')

  // Apply 0027 (add last_error to keys, backfill orphans, drop legacy columns)
  await apply(ordered(['0027']))

  const colsAfter = await db.prepare(`PRAGMA table_info(freellm_upstream_providers)`).all<{ name: string }>()
  const hasCipherAfter = colsAfter.results.some((c) => c.name === 'api_key_ciphertext')
  const hasIvAfter = colsAfter.results.some((c) => c.name === 'api_key_iv')
  assert.ok(!hasCipherAfter && !hasIvAfter, 'legacy columns dropped')

  // Legacy provider: its key should be in the pool
  const legacyKeys = await db.prepare('SELECT * FROM freellm_upstream_keys WHERE upstream_provider_id = ?').bind('prov-legacy').all()
  assert.equal(legacyKeys.results.length, 1)
  assert.equal(legacyKeys.results[0].api_key_ciphertext, 'legacy-cipher')
  assert.equal(legacyKeys.results[0].api_key_iv, 'legacy-iv')

  // Orphan provider: should have a backfilled key
  const orphanKeys = await db.prepare('SELECT * FROM freellm_upstream_keys WHERE upstream_provider_id = ?').bind('prov-orphan').all()
  assert.equal(orphanKeys.results.length, 1)
  assert.equal(orphanKeys.results[0].api_key_ciphertext, 'orphan-cipher')
  assert.equal(orphanKeys.results[0].label, 'default')

  // last_error column exists on keys table
  const keyCols = await db.prepare(`PRAGMA table_info(freellm_upstream_keys)`).all<{ name: string }>()
  const hasLastError = keyCols.results.some((c) => c.name === 'last_error')
  assert.ok(hasLastError, 'last_error column added to keys table')
})

test('migration 0033: legacy vault rows backfill into the unified connections table', async () => {
  db = await freshDb()
  const upTo0032 = Array.from({ length: 32 }, (_, i) => String(i + 1).padStart(4, '0'))
  await apply(ordered(upTo0032))

  const now = Date.now()
  const userId = 'user_mig33'
  await db
    .prepare(
      `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, created_at, updated_at)
       VALUES (?, 'u33@test.com', 'usermig33', NULL, 'code33', 0, 'user', 1, ?, ?)`,
    )
    .bind(userId, now, now)
    .run()

  // A manual key plus three OAuth grants — all provider='byok' in the legacy
  // table. Antigravity's endpoint shares googleapis.com with Google, so it must
  // not be claimed by the Google recovery rule.
  await db
    .prepare(
      `INSERT INTO freellm_api_keys (id, user_id, provider, label, key_ciphertext, key_iv, base_url, upstream_model, auth_kind, protocol, created_at, updated_at)
       VALUES
         ('k-manual', ?, 'byok', 'My key', 'ct', 'iv', 'https://api.openai.com/v1', 'gpt-4o-mini', 'api_key', 'openai', ?, ?),
         ('k-kilo',   ?, 'byok', 'Kilo (Auto)', 'ct', 'iv', 'https://api.kilo.ai/api/openrouter', 'google/gemini-2.5-flash', 'oauth', 'openai', ?, ?),
         ('k-codex',  ?, 'byok', 'Codex (Auto)', 'ct', 'iv', 'https://chatgpt.com/backend-api', 'gpt-5-codex', 'oauth', 'codex', ?, ?),
         ('k-anti',   ?, 'byok', 'Antigravity (Auto)', 'ct', 'iv', 'https://daily-cloudcode-pa.googleapis.com', 'gemini-3.8-flash', 'oauth', 'openai', ?, ?)`,
    )
    .bind(userId, now, now, userId, now, now, userId, now, now, userId, now, now)
    .run()

  await db
    .prepare(
      `INSERT INTO freellm_api_tokens (id, user_id, label, token_prefix, token_hash, created_at) VALUES ('t33', ?, 'laptop', 'fl_…', 'hash33', ?)`,
    )
    .bind(userId, now)
    .run()

  await apply(ordered(['0033']))

  const rows = await db
    .prepare('SELECT id, scope, owner_id, provider, auth_kind, protocol FROM freellm_connections')
    .all<{ id: string; scope: string; owner_id: string; provider: string; auth_kind: string; protocol: string }>()
  assert.equal(rows.results.length, 4, 'every legacy row migrated')
  const byId = Object.fromEntries(rows.results.map((r) => [r.id, r]))

  assert.equal(byId['k-manual'].scope, 'personal')
  assert.equal(byId['k-manual'].owner_id, userId)
  assert.equal(byId['k-manual'].provider, 'byok')
  assert.equal(byId['k-manual'].auth_kind, 'api_key')

  assert.equal(byId['k-kilo'].provider, 'kilo', 'OAuth provider recovered from base_url')
  assert.equal(byId['k-codex'].provider, 'codex')
  assert.equal(byId['k-codex'].protocol, 'codex')
  assert.equal(byId['k-anti'].provider, 'antigravity', 'Antigravity is not claimed by the Google match')

  const tokenCols = await db.prepare('PRAGMA table_info(freellm_api_tokens)').all<{ name: string }>()
  assert.ok(tokenCols.results.some((c) => c.name === 'connection_id'), 'tokens can bind to a connection')
  const token = await db
    .prepare('SELECT connection_id FROM freellm_api_tokens WHERE id = ?')
    .bind('t33')
    .first<{ connection_id: string | null }>()
  assert.equal(token?.connection_id, null, 'existing tokens stay unbound')

  // The legacy table is left in place as a rollback safety net.
  const legacy = await db.prepare('SELECT COUNT(*) AS n FROM freellm_api_keys').first<{ n: number }>()
  assert.equal(legacy?.n, 4, 'freellm_api_keys is preserved, not dropped')
})
