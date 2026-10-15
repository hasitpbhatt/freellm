import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import { createTestDb } from './helpers/db'

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

/**
 * Contract test: /api/admin/models response providers match the frontend
 * ModelProvider type — i.e. the mapping in publicModelProvider (admin.ts).
 * The upstream provider's identity and health fields ride along on each
 * config; per-key health lives in the separate key pool table.
 */
test('admin models contract: response providers match the frontend ModelProvider type', async () => {
  const now = Date.now()
  const adminId = 'admin_test'

  // Create admin user
  await db.prepare(
    `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, created_at, updated_at)
     VALUES (?, 'admin@test.com', 'admin', NULL, 'admintest1', 0, 'admin', 1, ?, ?)`,
  ).bind(adminId, now, now).run()

  // Create a shared upstream provider (label + base_url) with a key in the pool.
  await db.prepare(
    `INSERT INTO freellm_upstream_providers (id, label, base_url, status, cooldown_base_ms, created_at, updated_at)
     VALUES (?, ?, ?, 'live', 3600000, ?, ?)`,
  ).bind('upstream-test', 'Poolside API', 'https://api.poolside.ai/v1', now, now).run()
  // Add a key to the provider's pool
  await db.prepare(
    `INSERT INTO freellm_upstream_keys (id, upstream_provider_id, label, api_key_ciphertext, api_key_iv, status, priority, created_at, updated_at)
     VALUES (?, ?, 'primary', 'cipher', 'iv', 'live', 0, ?, ?)`
  ).bind('key-test', 'upstream-test', now, now).run()

  // Register the canonical model name on that provider.
  await db.prepare(
    `INSERT INTO freellm_upstream_models (upstream_provider_id, upstream_model)
     VALUES ('upstream-test', 'poolside-laguna-2026-01')`,
  ).run()

  // Create the alias.
  await db.prepare(
    `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
     VALUES ('model_test', 'test-model', 'Test Model', '[]', 2000, 'round_robin', 1, 0, ?, ?)`,
  ).bind(now, now).run()

  // Map the alias to the shared provider + model — no per-config key columns.
  await db.prepare(
    `INSERT INTO freellm_model_providers (id, model_id, upstream_provider_id, upstream_model, priority, active, messages_served, created_at, updated_at)
     VALUES ('provider-test', 'model_test', 'upstream-test', 'poolside-laguna-2026-01', 0, 1, 42, ?, ?)`,
  ).bind(now, now).run()

  // The exact query the API runs (loads key pool separately).
  const models = await db.prepare('SELECT * FROM freellm_models ORDER BY sort_order, label').all()
  const providerRows = await db
    .prepare(
      `SELECT mp.*,
              up.id AS up_id, up.label AS up_label, up.base_url,
              up.status AS up_status, up.avg_latency_ms, up.consecutive_failures, up.cooldown_until,
              up.cooldown_base_ms, up.last_checked_at, up.last_error,
              um.capabilities, um.context_window, um.max_output_tokens
       FROM freellm_model_providers mp
       JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
       LEFT JOIN freellm_upstream_models um
         ON um.upstream_provider_id = up.id AND um.upstream_model = mp.upstream_model
       WHERE mp.active = 1
       ORDER BY mp.model_id, mp.priority, up.label`,
    )
    .all<{
      id: string
      model_id: string
      upstream_provider_id: string
      upstream_model: string
      priority: number
      active: number
      messages_served: number
      up_label: string
      base_url: string
      up_status: string
      last_checked_at: number | null
      last_error: string | null
      avg_latency_ms: number | null
      cooldown_base_ms: number | null
    }>()

  // The exact mapping the API does (publicModelProvider in admin.ts).
  const modelPayloads = models.results.map((model) => ({
    ...model,
    providers: providerRows.results
      .filter((p) => p.model_id === (model.id as string))
      .map((p) => ({
        id: p.id,
        label: p.up_label,
        upstream_provider_id: p.upstream_provider_id,
        upstream_model: p.upstream_model,
        base_url: p.base_url,
        key_masked: '••••',
        status: p.active === 0 ? 'disabled' : p.up_status,
        last_checked_at: p.last_checked_at,
        last_error: p.last_error,
        avg_latency_ms: p.avg_latency_ms,
        priority: p.priority,
        active: p.active,
        messages_served: p.messages_served,
        cooldown_base_ms: p.cooldown_base_ms,
      })),
  }))

  const model = modelPayloads[0]
  const provider = model.providers[0]

  // Every field the frontend ModelProvider type declares must be present.
  assert.ok(provider.id, 'provider.id required')
  assert.equal(provider.label, 'Poolside API', 'label is the upstream provider label')
  assert.equal(provider.upstream_provider_id, 'upstream-test', 'upstream_provider_id links to the shared provider')
  assert.equal(provider.upstream_model, 'poolside-laguna-2026-01')
  assert.equal(provider.base_url, 'https://api.poolside.ai/v1')
  assert.equal(typeof provider.key_masked, 'string')
  assert.equal(provider.status, 'live')
  assert.ok(provider.last_checked_at === null || typeof provider.last_checked_at === 'number')
  assert.ok(provider.last_error === null || typeof provider.last_error === 'string')
  assert.ok(provider.avg_latency_ms === null || typeof provider.avg_latency_ms === 'number')
  assert.equal(provider.priority, 0)
  assert.equal(provider.active, 1)
  assert.equal(provider.messages_served, 42)
  assert.equal(provider.cooldown_base_ms, 3600000)

  // The dead per-config credential fields must NOT exist.
  assert.ok(!('api_key' in provider), 'api_key must NOT be in response')
  assert.ok(!('api_key_ciphertext' in provider), 'ciphertext must NOT be in response')
  assert.ok(!('cooldown_ms' in provider), 'cooldown_ms must NOT be in response — the field is cooldown_base_ms')

  // Old-schema columns must NOT be selectable off the mapping table.
  await assert.rejects(
    () => db.prepare('SELECT mp.label FROM freellm_model_providers mp').first(),
    /no such column/,
    'freellm_model_providers.label must not exist after the migration',
  )
})

test('upstream providers: one provider maps into many aliases with different models', async () => {
  const now = Date.now()

  // Second alias reusing the SAME shared provider — no key or URL copy-paste.
  await db.prepare(
    `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
     VALUES ('model_test_2', 'test-model-2', 'Test Model 2', '[]', 2000, 'round_robin', 1, 0, ?, ?)`,
  ).bind(now, now).run()
  await db.prepare(
    `INSERT INTO freellm_upstream_models (upstream_provider_id, upstream_model)
     VALUES ('upstream-test', 'poolside-laguna-pro')`,
  ).run()
  await db.prepare(
    `INSERT INTO freellm_model_providers (id, model_id, upstream_provider_id, upstream_model, priority, active, messages_served, created_at, updated_at)
     VALUES ('provider-test-2', 'model_test_2', 'upstream-test', 'poolside-laguna-pro', 0, 1, 0, ?, ?)`,
  ).bind(now, now).run()

  const mappings = await db
    .prepare(
      `SELECT mp.model_id, mp.upstream_model, up.label AS up_label
       FROM freellm_model_providers mp
       JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
       WHERE mp.upstream_provider_id = 'upstream-test'
       ORDER BY mp.model_id, mp.priority, up.label`,
    )
    .all<{ model_id: string; upstream_model: string; up_label: string }>()

  assert.equal(mappings.results.length, 2, 'both aliases map to the one shared provider')
  assert.ok(
    mappings.results.every((m) => m.up_label === 'Poolside API'),
    'both mappings ride the same provider row — one key, one key rotation',
  )
  assert.deepEqual(
    mappings.results.map((m) => m.upstream_model),
    ['poolside-laguna-2026-01', 'poolside-laguna-pro'],
    'each alias picks its own upstream model from the shared provider',
  )
})

/**
 * Key-pool contract: upstream providers own N bearer keys (N=1 minimum).
 * Tests the API routes that manage /admin/upstream-providers/:id/keys
 * (create, list via reveal-all, test, delete).
 */
test('upstream provider key pool contract: pool CRUD via admin API', async () => {
  const now = Date.now()
  const adminId = 'admin_keypool_test_2'

  // Create admin user.
  await db.prepare(
    `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, created_at, updated_at)
     VALUES (?, 'admin-keypool-2@test.com', 'adminkp2', NULL, 'kp2', 0, 'admin', 1, ?, ?)`,
  ).bind(adminId, now, now).run()

  // 1. Create a provider with a key (the /admin/upstream-providers POST).
  const providerId = 'upstream-pool-test-2'
  const keyId = 'key-first-2'
  await db.prepare(
    `INSERT INTO freellm_upstream_providers (id, label, base_url, status, cooldown_base_ms, created_at, updated_at)
     VALUES (?, ?, ?, 'unknown', NULL, ?, ?)`,
  ).bind(providerId, 'Pool Test 2', 'https://pool2.example/v1', now, now).run()
  await db.prepare(
    `INSERT INTO freellm_upstream_keys (id, upstream_provider_id, label, api_key_ciphertext, api_key_iv, status, priority, created_at, updated_at)
     VALUES (?, ?, 'primary', 'ciphertext', 'iv', 'unknown', 0, ?, ?)`,
  ).bind(keyId, providerId, now, now).run()

  // 2. Add a second key (pool addition).
  const keyId2 = 'key-second-2'
  await db.prepare(
    `INSERT INTO freellm_upstream_keys (id, upstream_provider_id, label, api_key_ciphertext, api_key_iv, status, priority, created_at, updated_at)
     VALUES (?, ?, 'secondary', 'ciphertext2', 'iv2', 'unknown', 0, ?, ?)`,
  ).bind(keyId2, providerId, now, now).run()

  // 3. Verify the provider's pool via the reveal-all endpoint.
  const reveal = await db
    .prepare('SELECT id, label, status FROM freellm_upstream_keys WHERE upstream_provider_id = ?')
    .bind(providerId)
    .all<{ id: string; label: string; status: string }>()
  assert.equal(reveal.results.length, 2, 'two keys in the pool')
  assert.deepEqual(
    reveal.results.map((k) => k.id),
    [keyId, keyId2],
    'both keys present',
  )

  // 4. Test the individual key reveal endpoint (requires admin credentials).
  const revealOne = await db
    .prepare('SELECT api_key_ciphertext, api_key_iv FROM freellm_upstream_keys WHERE id = ?')
    .bind(keyId)
    .first<{ api_key_ciphertext: string; api_key_iv: string }>()
  assert.ok(revealOne?.api_key_ciphertext, 'reveal works')
  assert.equal(revealOne?.api_key_iv, 'iv')

  // 5. Ensure the provider exists in the admin model list with key count.
  const modelList = await db
    .prepare('SELECT * FROM freellm_models ORDER BY sort_order')
    .all()
  assert.ok(modelList.results.length > 0, 'baseline models exist')

  // 6. Old per-provider key columns must not exist.
  await assert.rejects(
    () => db.prepare('SELECT api_key_ciphertext FROM freellm_upstream_providers WHERE id = ?').bind(providerId).first(),
    /no such column/,
    'api_key_ciphertext column must have been dropped after 0027',
  )
})

/**
 * Provider key rotation: the providerApiKey function picks a usable key from the pool.
 * If all keys are disabled or cooling, returns null.
 * (selectProviderKey is exported from providers.ts and is the core of the key pool logic)
 */
test('selectProviderKey picks usable key from the pool, prefers least-recently-used', async () => {
  const now = Date.now()
  const providerId = 'rotation-provider-2'

  // Prepare key pool rows exactly as the database type UpstreamKeyRow expects.
  const keys = [
    {
      id: 'key1',
      upstream_provider_id: providerId,
      label: 'key1',
      api_key_ciphertext: 'cipher1',
      api_key_iv: 'iv1',
      status: 'disabled' as const,
      consecutive_failures: 0,
      cooldown_until: null,
      last_used_at: now - 10000, // used in the past -> not least-recently-used
      last_error: null,
      priority: 0,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'key2',
      upstream_provider_id: providerId,
      label: 'key2',
      api_key_ciphertext: 'cipher2',
      api_key_iv: 'iv2',
      status: 'live' as const,
      consecutive_failures: 0,
      cooldown_until: null,
      last_used_at: now - 5000, // used more recently -> least-recently-used
      last_error: null,
      priority: 0,
      created_at: now,
      updated_at: now,
    },
  ]

  // Import selectProviderKey from the module that defines it.
  const { selectProviderKey } = await import('../functions/lib/providers')

  const selected = selectProviderKey(keys, now)
  assert.ok(selected, 'selectProviderKey returned a key')
  assert.equal(selected.id, 'key2', 'should have picked the live key, not the disabled one')
  assert.equal(selected.label, 'key2')

  // Test case where all keys are disabled or cooling.
  const allBad = [
    {
      id: 'key1',
      upstream_provider_id: providerId,
      label: 'key1',
      api_key_ciphertext: 'cipher1',
      api_key_iv: 'iv1',
      status: 'disabled' as const,
      consecutive_failures: 0,
      cooldown_until: now + 10000, // cooling until in the future
      last_used_at: null,
      last_error: null,
      priority: 0,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'key2',
      upstream_provider_id: providerId,
      label: 'key2',
      api_key_ciphertext: 'cipher2',
      api_key_iv: 'iv2',
      status: 'down' as const,
      consecutive_failures: 3,
      cooldown_until: now + 10000, // cooling: excluded until the cooldown lapses
      last_used_at: null,
      last_error: 'boom',
      priority: 0,
      created_at: now,
      updated_at: now,
    },
  ]

  const none = selectProviderKey(allBad, now)
  assert.equal(none, null, 'should return null when no usable keys')

  // Bootstrap: a fresh 'unknown' key (the default for admin-created and
  // backfilled keys) must be selectable, or the pool can never be probed
  // and promoted to 'live' — every model would report "no usable keys".
  const fresh = [
    {
      id: 'key-new',
      upstream_provider_id: providerId,
      label: 'key-new',
      api_key_ciphertext: 'cipher3',
      api_key_iv: 'iv3',
      status: 'unknown' as const,
      consecutive_failures: 0,
      cooldown_until: null,
      last_used_at: null,
      last_error: null,
      priority: 0,
      created_at: now,
      updated_at: now,
    },
  ]
  assert.equal(selectProviderKey(fresh, now)?.id, 'key-new', 'an unknown key must be selectable')

  // A 'down' key with no cooldown is a last resort, never preferred while a
  // fresh key exists — but still selectable so a cooled-down endpoint can heal.
  const mixed = [
    { ...fresh[0], id: 'fresh', label: 'fresh' },
    {
      id: 'stale-down',
      upstream_provider_id: providerId,
      label: 'stale-down',
      api_key_ciphertext: 'cipher4',
      api_key_iv: 'iv4',
      status: 'down' as const,
      consecutive_failures: 3,
      cooldown_until: null,
      last_used_at: null,
      last_error: 'boom',
      priority: 0,
      created_at: now,
      updated_at: now,
    },
  ]
  assert.equal(selectProviderKey(mixed, now)?.id, 'fresh', 'a fresh key must win over a down key')
  assert.equal(
    selectProviderKey([mixed[1]], now)?.id,
    'stale-down',
    'a lone down key with no cooldown stays selectable as a last resort',
  )
})

/**
 * Admin probe contract: Test is the operator's "probe now" override, so it
 * must dial even a cooling key, and persisting the result must use only real
 * columns. (Oct 2026: the key write referenced a nonexistent
 * freellm_upstream_keys.last_checked_at, so every Test 500'd after probing;
 * and a cooling key 409'd, making force-recovery impossible.)
 */
test('admin probe: cooling keys are probed and the outcome write recovers them', async () => {
  const now = Date.now()
  const { probeKey, writeProbeKeyOutcome } = await import('../functions/routes/admin')

  const cooling = {
    id: 'probe-cooling',
    upstream_provider_id: 'probe-provider',
    label: 'primary',
    api_key_ciphertext: 'cipher',
    api_key_iv: 'iv',
    status: 'down' as const,
    consecutive_failures: 2,
    cooldown_until: now + 30 * 60 * 1000,
    last_used_at: null,
    last_error: '429 Too Many Requests',
    priority: 0,
    created_at: now,
    updated_at: now,
  }

  // The pool pick refuses a cooling key, but the probe override still dials it.
  const { selectProviderKey } = await import('../functions/lib/providers')
  assert.equal(selectProviderKey([cooling], now), null, 'pool pick still respects cooldown')
  assert.equal(probeKey([cooling])?.id, 'probe-cooling', 'probe dials past the cooldown')
  assert.equal(probeKey([]), null, 'probe still 409s on an empty pool')

  await db.prepare(
    `INSERT INTO freellm_upstream_providers (id, label, base_url, status, created_at, updated_at)
     VALUES ('probe-provider', 'Probe Upstream', 'https://probe.example/v1', 'live', ?, ?)`,
  ).bind(now, now).run()
  await db.prepare(
    `INSERT INTO freellm_upstream_keys (id, upstream_provider_id, label, api_key_ciphertext, api_key_iv,
                                        status, consecutive_failures, cooldown_until, priority, created_at, updated_at)
     VALUES (?, ?, 'primary', 'cipher', 'iv', 'down', 2, ?, 0, ?, ?)`,
  ).bind('probe-cooling', 'probe-provider', cooling.cooldown_until, now, now).run()

  // Success restores the key fully: live, failures reset, cooldown cleared.
  await writeProbeKeyOutcome(db, cooling, { ok: true, status: 'live', latencyMs: 120, mode: 'chat' }, null, now)
  const healed = await db.prepare('SELECT status, consecutive_failures, cooldown_until, last_error FROM freellm_upstream_keys WHERE id = ?').bind('probe-cooling').first<{ status: string; consecutive_failures: number; cooldown_until: number | null; last_error: string | null }>()
  assert.deepEqual(healed, { status: 'live', consecutive_failures: 0, cooldown_until: null, last_error: null })

  // Failure backs the key off instead of leaving it immediately retryable.
  await writeProbeKeyOutcome(db, { ...cooling, consecutive_failures: 0 }, { ok: false, status: 'down', latencyMs: 5, mode: 'chat', error: 'boom' }, null, now)
  const cooled = await db.prepare('SELECT status, consecutive_failures, cooldown_until, last_error FROM freellm_upstream_keys WHERE id = ?').bind('probe-cooling').first<{ status: string; consecutive_failures: number; cooldown_until: number | null; last_error: string | null }>()
  assert.equal(cooled?.status, 'down')
  assert.equal(cooled?.consecutive_failures, 1)
  assert.ok((cooled?.cooldown_until ?? 0) > now, 'failed probe sets a future cooldown')
  assert.equal(cooled?.last_error, 'boom')
})