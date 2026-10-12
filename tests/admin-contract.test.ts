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
 * config; per-config credentials do not exist anymore (they live on the
 * shared upstream provider).
 */
test('admin models contract: response providers match the frontend ModelProvider type', async () => {
  const now = Date.now()
  const adminId = 'admin_test'

  // Create admin user
  await db.prepare(
    `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, created_at, updated_at)
     VALUES (?, 'admin@test.com', 'admin', NULL, 'admintest1', 0, 'admin', 1, ?, ?)`,
  ).bind(adminId, now, now).run()

  // Create a shared upstream provider (label + base_url + one key).
  await db.prepare(
    `INSERT INTO freellm_upstream_providers (id, label, base_url, api_key_ciphertext, api_key_iv, status, cooldown_base_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'live', 3600000, ?, ?)`,
  ).bind('upstream-test', 'Poolside API', 'https://api.poolside.ai/v1', 'cipher', 'iv', now, now).run()

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

  // The exact query the API runs (fixed: ORDER BY up.label — mp.label no
  // longer exists after the shared-upstream-providers migration).
  const models = await db.prepare('SELECT * FROM freellm_models ORDER BY sort_order, label').all()
  const providerRows = await db
    .prepare(
      `SELECT mp.*,
              up.id AS up_id, up.label AS up_label, up.base_url, up.api_key_ciphertext, up.api_key_iv,
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
      api_key_ciphertext: string
      api_key_iv: string
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
