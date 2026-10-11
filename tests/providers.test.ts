import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import {
  FAILED_PROVIDER_COOLDOWN_MS,
  LATENCY_WEIGHTED_EXPLORATION_RATE,
  MAX_PROVIDER_COOLDOWN_MS,
  cooldownForAttempt,
  openStreamingCall,
  recordOutcome,
  resolveCandidates,
  sortByLatency,
} from '../functions/lib/providers'
import { encryptSecret } from '../functions/lib/crypto'
import type { Bindings, ModelProviderRow } from '../functions/lib/types'
import { createTestDb, testModel } from './helpers/db'

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

function providerRow(id: string, priority: number, overrides: Partial<ModelProviderRow> = {}): ModelProviderRow {
  return {
    id,
    model_id: 'model_test',
    label: id,
    base_url: 'https://provider.example/v1',
    upstream_model: 'test-upstream',
    api_key_ciphertext: 'ciphertext',
    api_key_iv: 'iv',
    status: 'live',
    last_checked_at: null,
    last_error: null,
    avg_latency_ms: null,
    cooldown_until: null,
    cooldown_ms: null,
    priority,
    active: 1,
    messages_served: 0,
    consecutive_failures: 0,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  }
}

function kvMock(initial = '') {
  let value = initial
  return {
    get: async (_key: string) => value,
    put: async (_key: string, v: string) => {
      value = v
    },
  }
}

async function storedProviders(): Promise<ModelProviderRow[]> {
  const rows = await db
    .prepare('SELECT * FROM freellm_model_providers WHERE model_id = ? ORDER BY priority')
    .bind('model_test')
    .all<ModelProviderRow>()
  return rows.results
}

test('failed providers cool down for 30 minutes while healthy providers stay eligible', async () => {
  const env = { DB: db } as unknown as Bindings
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
       VALUES ('model_test', 'test-model', 'Test Model', '[]', 2000, 'failover', 1, 0, ?, ?)`,
    )
    .bind(now, now)
    .run()
  for (const row of [providerRow('provider-a', 0), providerRow('provider-b', 1)]) {
    await db
      .prepare(
        `INSERT INTO freellm_model_providers (id, model_id, label, base_url, upstream_model, api_key_ciphertext, api_key_iv,
                                              status, priority, active, messages_served, consecutive_failures, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.id,
        row.model_id,
        row.label,
        row.base_url,
        row.upstream_model,
        row.api_key_ciphertext,
        row.api_key_iv,
        row.status,
        row.priority,
        row.active,
        row.messages_served,
        row.consecutive_failures,
        now,
        now,
      )
      .run()
  }

  await recordOutcome(env, 'provider-a', { ok: false, latencyMs: 12, error: '502 upstream' })
  const [failed, healthy] = await storedProviders()
  assert.equal(failed.status, 'down')
  assert.ok(
    (failed.cooldown_until ?? 0) >= now + FAILED_PROVIDER_COOLDOWN_MS,
    'a failure starts the full cooldown window',
  )

  const duringCooldown = await resolveCandidates(
    env,
    { model: { ...testModel, routing: 'failover' }, providers: [failed, healthy] },
    now,
  )
  assert.deepEqual(
    duringCooldown.map((candidate) => candidate.id),
    ['provider-b'],
    'the failed provider is skipped while alternatives remain',
  )

  await db
    .prepare("UPDATE freellm_model_providers SET status = 'live', cooldown_until = ? WHERE id = ?")
    .bind(now - 1, 'provider-a')
    .run()
  const afterCooldown = await resolveCandidates(
    env,
    { model: { ...testModel, routing: 'failover' }, providers: await storedProviders() },
    now,
  )
  assert.deepEqual(
    afterCooldown.map((candidate) => candidate.id),
    ['provider-a', 'provider-b'],
    'the provider becomes eligible again after 30 minutes',
  )

  await db
    .prepare("UPDATE freellm_model_providers SET status = 'down', cooldown_until = ? WHERE id = ?")
    .bind(now + FAILED_PROVIDER_COOLDOWN_MS, 'provider-a')
    .run()
  await recordOutcome(env, 'provider-a', { ok: true, latencyMs: 12 })
  const recovered = (await storedProviders()).find((row) => row.id === 'provider-a')
  assert.equal(recovered?.status, 'live')
  assert.equal(recovered?.cooldown_until, null)
})

test('openStreamingCall tries the next provider after an upstream refusal', async () => {
  const key = Buffer.alloc(32).toString('base64')
  const encrypted = await encryptSecret('test-key', key)
  const env = { DB: db, ENCRYPTION_KEY: key } as unknown as Bindings
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
       VALUES ('model_failover', 'failover-model', 'Failover Model', '[]', 2000, 'failover', 1, 0, ?, ?)`,
    )
    .bind(now, now)
    .run()
  for (const [id, baseUrl] of [
    ['fail-a', 'https://a.example/v1'],
    ['fail-b', 'https://b.example/v1'],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO freellm_model_providers (id, model_id, label, base_url, upstream_model, api_key_ciphertext, api_key_iv,
                                              status, priority, active, messages_served, consecutive_failures, created_at, updated_at)
         VALUES (?, 'model_failover', ?, ?, 'test-upstream', ?, ?, 'live', 0, 1, 0, 0, ?, ?)`,
      )
      .bind(id, id, baseUrl, encrypted.ciphertext, encrypted.iv, now, now)
      .run()
  }

  const requestedUrls: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    requestedUrls.push(url)
    if (url.startsWith('https://a.example/v1')) return new Response('bad gateway', { status: 502 })
    return new Response('ok', { status: 200 })
  }) as unknown as typeof fetch
  try {
    const opened = await openStreamingCall(
      env,
      {
        model: { ...testModel, id: 'model_failover', slug: 'failover-model', routing: 'failover' },
        providers: await db
          .prepare('SELECT * FROM freellm_model_providers WHERE model_id = ? ORDER BY priority')
          .bind('model_failover')
          .all<ModelProviderRow>()
          .then((rows) => rows.results),
      },
      [{ role: 'user', content: 'hi' }],
      { maxTokens: 10 },
    )
    assert.equal('error' in opened, false)
    if (!('error' in opened)) {
      assert.equal(opened.provider.id, 'fail-b')
      assert.equal(opened.response.status, 200)
    }
    assert.deepEqual(requestedUrls, [
      'https://a.example/v1/chat/completions',
      'https://b.example/v1/chat/completions',
    ])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('latency_weighted exploit orders by lowest EWMA, unknown last', async () => {
  const store = kvMock()
  const env = { DB: db, freellm_sessions: store } as unknown as Bindings
  const now = Date.now()
  const providers = [
    providerRow('slow', 0, { avg_latency_ms: 5000 }),
    providerRow('fast', 0, { avg_latency_ms: 200 }),
    providerRow('unknown', 0, { avg_latency_ms: null }),
    providerRow('mid', 1, { avg_latency_ms: 800 }),
  ]
  const candidates = await resolveCandidates(
    env,
    { model: { ...testModel, routing: 'latency_weighted' }, providers },
    now,
    { random: () => 0.99 },
  )
  assert.deepEqual(
    candidates.map((c) => c.id),
    ['fast', 'mid', 'slow', 'unknown'],
  )
})

test('latency_weighted exploit skips cooldown providers even when fastest', async () => {
  const store = kvMock()
  const env = { DB: db, freellm_sessions: store } as unknown as Bindings
  const now = Date.now()
  const providers = [
    providerRow('fast-cooling', 0, { avg_latency_ms: 50, cooldown_until: now + FAILED_PROVIDER_COOLDOWN_MS }),
    providerRow('slow-rested', 0, { avg_latency_ms: 4000 }),
  ]
  const candidates = await resolveCandidates(
    env,
    { model: { ...testModel, routing: 'latency_weighted' }, providers },
    now,
    { random: () => 0.99 },
  )
  assert.deepEqual(candidates.map((c) => c.id), ['slow-rested'])
})

test('latency_weighted explore rotates round-robin over rested pool only', async () => {
  assert.ok(LATENCY_WEIGHTED_EXPLORATION_RATE > 0 && LATENCY_WEIGHTED_EXPLORATION_RATE < 1)
  const store = kvMock('')
  const env = { DB: db, freellm_sessions: store } as unknown as Bindings
  const now = Date.now()
  const providers = [
    providerRow('a', 0, { avg_latency_ms: 100 }),
    providerRow('b', 0, { avg_latency_ms: 200 }),
    providerRow('cooling', 0, { avg_latency_ms: 10, cooldown_until: now + FAILED_PROVIDER_COOLDOWN_MS }),
  ]
  const first = await resolveCandidates(
    env,
    { model: { ...testModel, routing: 'latency_weighted' }, providers },
    now,
    { random: () => 0 },
  )
  assert.deepEqual(first.map((c) => c.id), ['b', 'a'])
  const second = await resolveCandidates(
    env,
    { model: { ...testModel, routing: 'latency_weighted' }, providers },
    now,
    { random: () => 0 },
  )
  assert.deepEqual(second.map((c) => c.id), ['a', 'b'])
})

test('cooldownForAttempt: default base reproduces the 30m ladder to the 4h cap', () => {
  assert.equal(cooldownForAttempt(FAILED_PROVIDER_COOLDOWN_MS, 1), 30 * 60 * 1000)
  assert.equal(cooldownForAttempt(FAILED_PROVIDER_COOLDOWN_MS, 2), 60 * 60 * 1000)
  assert.equal(cooldownForAttempt(FAILED_PROVIDER_COOLDOWN_MS, 3), 2 * 60 * 60 * 1000)
  assert.equal(cooldownForAttempt(FAILED_PROVIDER_COOLDOWN_MS, 4), MAX_PROVIDER_COOLDOWN_MS)
  assert.equal(cooldownForAttempt(FAILED_PROVIDER_COOLDOWN_MS, 10), MAX_PROVIDER_COOLDOWN_MS)
})

test('cooldownForAttempt: daily-quota base (llm7.io style) ladders 1d, 2d, capped', () => {
  const day = 24 * 60 * 60 * 1000
  assert.equal(cooldownForAttempt(day, 1), day)
  assert.equal(cooldownForAttempt(day, 2), 2 * day)
  assert.equal(cooldownForAttempt(day, 5), 7 * day)
  assert.equal(cooldownForAttempt(0, 3), 0)
})

test('recordOutcome: provider cooldown_ms overrides the global base', async () => {
  const env = { DB: db } as unknown as Bindings
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  await db
    .prepare(
      `INSERT OR REPLACE INTO freellm_model_providers (id, model_id, label, base_url, upstream_model, api_key_ciphertext, api_key_iv,
                                                       status, priority, active, messages_served, consecutive_failures, cooldown_ms, created_at, updated_at)
       VALUES ('cooldown-custom', 'model_test', 'cooldown-custom', 'https://x.example/v1', 'm', 'c', 'iv', 'live', 0, 1, 0, 0, ?, ?, ?)`,
    )
    .bind(day, now, now)
    .run()
  const before = Date.now()
  await recordOutcome(env, 'cooldown-custom', { ok: false, latencyMs: 10, error: 'quota exhausted' })
  const row = (await db.prepare('SELECT consecutive_failures, cooldown_until FROM freellm_model_providers WHERE id = ?')
    .bind('cooldown-custom')
    .first<{ consecutive_failures: number; cooldown_until: number }>())!
  assert.equal(row.consecutive_failures, 1)
  assert.ok(row.cooldown_until >= before + day)
  assert.ok(row.cooldown_until <= Date.now() + day + 5000)
})

test('sortByLatency breaks EWMA ties by priority', () => {
  const providers = [
    providerRow('p1', 5, { avg_latency_ms: 300 }),
    providerRow('p0', 0, { avg_latency_ms: 300 }),
  ]
  assert.deepEqual(
    sortByLatency(providers).map((c) => c.id),
    ['p0', 'p1'],
  )
})

test('slow configs are skipped while live configs are rested', async () => {
  const store = kvMock()
  const env = { DB: db, freellm_sessions: store } as unknown as Bindings
  const now = Date.now()
  const providers = [
    providerRow('slow', 0, { status: 'slow', avg_latency_ms: 9000 }),
    providerRow('live', 0, { status: 'live', avg_latency_ms: 5000 }),
  ]
  const candidates = await resolveCandidates(
    env,
    { model: { ...testModel, routing: 'failover' }, providers },
    now,
  )
  assert.deepEqual(candidates.map((c) => c.id), ['live'])
})

test('all-slow pool is still usable when nothing better exists', async () => {
  const store = kvMock()
  const env = { DB: db, freellm_sessions: store } as unknown as Bindings
  const now = Date.now()
  const providers = [
    providerRow('slow-a', 1, { status: 'slow', avg_latency_ms: 9000 }),
    providerRow('slow-b', 0, { status: 'slow', avg_latency_ms: 9500 }),
  ]
  const candidates = await resolveCandidates(
    env,
    { model: { ...testModel, routing: 'failover' }, providers },
    now,
  )
  assert.deepEqual(candidates.map((c) => c.id), ['slow-b', 'slow-a'])
})

test('consecutive failures back off exponentially up to the cap', async () => {
  const env = { DB: db } as unknown as Bindings
  const now = Date.now()
  await db
    .prepare(
      `INSERT OR REPLACE INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
       VALUES ('model_backoff', 'backoff-model', 'Backoff Model', '[]', 2000, 'failover', 1, 0, ?, ?)`,
    )
    .bind(now, now)
    .run()
  await db
    .prepare(
      `INSERT OR REPLACE INTO freellm_model_providers (id, model_id, label, base_url, upstream_model, api_key_ciphertext, api_key_iv,
                                                       status, priority, active, messages_served, consecutive_failures, cooldown_until, created_at, updated_at)
       VALUES ('backoff-a', 'model_backoff', 'backoff-a', 'https://x.example/v1', 'm', 'c', 'iv', 'live', 0, 1, 0, 0, NULL, ?, ?)`,
    )
    .bind(now, now)
    .run()

  const before1 = Date.now()
  await recordOutcome(env, 'backoff-a', { ok: false, latencyMs: 10, error: 'boom' })
  const after1 = (await db.prepare('SELECT consecutive_failures, cooldown_until FROM freellm_model_providers WHERE id = ?')
    .bind('backoff-a')
    .first<{ consecutive_failures: number; cooldown_until: number }>())!
  assert.equal(after1.consecutive_failures, 1)
  assert.ok(after1.cooldown_until >= before1 + FAILED_PROVIDER_COOLDOWN_MS)
  assert.ok(after1.cooldown_until <= Date.now() + FAILED_PROVIDER_COOLDOWN_MS + 5000)

  // Reset cooldown so the second failure can be recorded, keeping the failure count.
  await db.prepare('UPDATE freellm_model_providers SET cooldown_until = NULL WHERE id = ?').bind('backoff-a').run()
  const before2 = Date.now()
  await recordOutcome(env, 'backoff-a', { ok: false, latencyMs: 10, error: 'boom' })
  const after2 = (await db.prepare('SELECT consecutive_failures, cooldown_until FROM freellm_model_providers WHERE id = ?')
    .bind('backoff-a')
    .first<{ consecutive_failures: number; cooldown_until: number }>())!
  assert.equal(after2.consecutive_failures, 2)
  assert.ok(after2.cooldown_until >= before2 + FAILED_PROVIDER_COOLDOWN_MS * 2 - 5000)
  assert.ok(after2.cooldown_until <= Date.now() + MAX_PROVIDER_COOLDOWN_MS + 5000)
})
