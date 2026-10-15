import { after, afterEach, before, test } from 'node:test'
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
import type { Bindings, ModelProviderRow, UpstreamProviderWithModel, UpstreamKeyRow } from '../functions/lib/types'
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

afterEach(async () => {
  // Clean up all test data for model_test in correct FK order
  await db.prepare("DELETE FROM freellm_model_providers WHERE model_id = 'model_test'").run()
  await db.prepare("DELETE FROM freellm_upstream_providers").run()
  await db.prepare("DELETE FROM freellm_upstream_models").run()
  await db.prepare("DELETE FROM freellm_models WHERE id LIKE 'model_%' AND id NOT IN ('model_test', 'model_failover')").run()
})

/** Create a test upstream provider row. */
async function createUpstreamProvider(
  id: string,
  overrides: Partial<UpstreamProviderWithModel> & { encryptionKey?: string } = {}
): Promise<UpstreamProviderWithModel> {
  const now = Date.now()
  const key = overrides.encryptionKey ?? Buffer.alloc(32).toString('base64')
  const encrypted = await encryptSecret('test-key', key)
  const row: UpstreamProviderWithModel = {
    id,
    label: id,
    base_url: 'https://provider.example/v1',
    status: 'live',
    last_checked_at: null,
    last_error: null,
    avg_latency_ms: null,
    consecutive_failures: 0,
    cooldown_until: null,
    cooldown_base_ms: null,
    created_at: now,
    updated_at: now,
    model_capabilities: [],
    keys: [{
      id: `key-${id}`,
      upstream_provider_id: id,
      label: 'default',
      api_key_ciphertext: encrypted.ciphertext,
      api_key_iv: encrypted.iv,
      status: 'live',
      consecutive_failures: 0,
      cooldown_until: null,
      last_used_at: null,
      last_error: null,
      priority: 0,
      created_at: now,
      updated_at: now,
    }],
    supports_streaming: 1,
    ...overrides,
  }
  await db.prepare(
    `INSERT OR REPLACE INTO freellm_upstream_providers (id, label, base_url,
                                             status, avg_latency_ms, consecutive_failures,
                                             cooldown_until, cooldown_base_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      row.label,
      row.base_url,
      row.status,
      row.avg_latency_ms,
      row.consecutive_failures,
      row.cooldown_until,
      row.cooldown_base_ms,
      row.created_at,
      row.updated_at,
    )
    .run()
  // Insert the key into the key pool
  await db.prepare(
    `INSERT OR REPLACE INTO freellm_upstream_keys (id, upstream_provider_id, label, api_key_ciphertext, api_key_iv,
                                     status, consecutive_failures, cooldown_until, priority, created_at, updated_at)
     VALUES (?, ?, 'default', ?, ?, 'live', 0, NULL, 0, ?, ?)`
  )
    .bind(row.keys[0].id, row.id, encrypted.ciphertext, encrypted.iv, now, now)
    .run()
  // Also create upstream_models entry for 'test-upstream' to satisfy FK
  await db.prepare(
    `INSERT OR IGNORE INTO freellm_upstream_models (upstream_provider_id, upstream_model)
     VALUES (?, 'test-upstream')`
  ).bind(row.id).run()
  return row
}

/** Create a test model provider row linking to an upstream provider. */
async function createModelProvider(
  id: string,
  upstreamProviderId: string,
  priority: number,
  overrides: Partial<ModelProviderRow> = {}
): Promise<ModelProviderRow> {
  const now = Date.now()
  const row: ModelProviderRow = {
    id,
    model_id: 'model_test',
    upstream_provider_id: upstreamProviderId,
    upstream_model: 'test-upstream',
    priority,
    active: 1,
    messages_served: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
  await db.prepare(
    `INSERT OR REPLACE INTO freellm_model_providers (id, model_id, upstream_provider_id, upstream_model,
                                         priority, active, messages_served, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(row.id, row.model_id, row.upstream_provider_id, row.upstream_model,
          row.priority, row.active, row.messages_served, row.created_at, row.updated_at)
    .run()
  return row
}

function providerRow(id: string, upstreamProviderId: string, priority: number, overrides: Partial<ModelProviderRow> = {}): ModelProviderRow {
  const now = Date.now()
  return {
    id,
    model_id: 'model_test',
    upstream_provider_id: upstreamProviderId,
    upstream_model: 'test-upstream',
    priority,
    active: 1,
    messages_served: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function upstreamProviderRow(id: string, overrides: Partial<UpstreamProviderWithModel> = {}): UpstreamProviderWithModel {
  const now = Date.now()
  return {
    id,
    label: id,
    base_url: 'https://provider.example/v1',
    status: 'live',
    last_checked_at: null,
    last_error: null,
    avg_latency_ms: null,
    consecutive_failures: 0,
    cooldown_until: null,
    cooldown_base_ms: null,
    created_at: now,
    updated_at: now,
    model_capabilities: [],
    keys: [{
      id: `key-${id}`,
      upstream_provider_id: id,
      label: 'default',
      api_key_ciphertext: 'ciphertext',
      api_key_iv: 'iv',
      status: 'live',
      consecutive_failures: 0,
      cooldown_until: null,
      last_used_at: null,
      last_error: null,
      priority: 0,
      created_at: now,
      updated_at: now,
    }],
    supports_streaming: 1,
    ...overrides,
  }
}

function kvMock(initial = '') {
  let value = initial
  return {
    get: async (_key: string) => value,
    put: async (_key: string, v: string) => { value = v },
  }
}

async function storedUpstreamProviders(): Promise<UpstreamProviderWithModel[]> {
  const providerRows = await db
    .prepare('SELECT *, NULL AS model_capabilities FROM freellm_upstream_providers ORDER BY label')
    .all<UpstreamProviderWithModel>()
  const providers = providerRows.results
  
  // Load key pools for all providers
  const upstreamIds = [...new Set(providers.map((p) => p.id))]
  const keyRows = upstreamIds.length
    ? (
        await db.prepare(
          `SELECT * FROM freellm_upstream_keys
           WHERE upstream_provider_id IN (${upstreamIds.map(() => '?').join(',')})
           ORDER BY priority ASC, COALESCE(last_used_at, 0) ASC`,
        )
          .bind(...upstreamIds)
          .all<UpstreamKeyRow>()
      ).results
    : []
  const keysByProvider = new Map<string, UpstreamKeyRow[]>()
  for (const key of keyRows) {
    const list = keysByProvider.get(key.upstream_provider_id) ?? []
    list.push(key)
    keysByProvider.set(key.upstream_provider_id, list)
  }
  
  return providers.map((p) => ({
    ...p,
    keys: keysByProvider.get(p.id) ?? [],
  }))
}

test('failed providers cool down for 30 minutes while healthy providers stay eligible', async () => {
  const env = { DB: db } as unknown as Bindings
  const now = Date.now()
  
  await db.prepare(
    `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
     VALUES ('model_test', 'test-model', 'Test Model', '[]', 2000, 'failover', 1, 0, ?, ?)`,
  ).bind(now, now).run()

  // Create two upstream providers
  await createUpstreamProvider('upstream-a')
  await createUpstreamProvider('upstream-b')
  
  // Create two model providers linking to them
  const mpA = await createModelProvider('provider-a', 'upstream-a', 0)
  const mpB = await createModelProvider('provider-b', 'upstream-b', 1)

  await recordOutcome(env, 'upstream-a', 'provider-a', { ok: false, latencyMs: 12, error: '502 upstream' })

  const storedUps = await storedUpstreamProviders()
  const failedUp = storedUps.find(r => r.id === 'upstream-a')!
  assert.equal(failedUp.status, 'down')
  assert.ok(
    (failedUp.cooldown_until ?? 0) >= now + FAILED_PROVIDER_COOLDOWN_MS,
    'a failure starts the full cooldown window',
  )

  const duringCooldown = await resolveCandidates(
    env,
    { 
      model: { ...testModel, routing: 'failover' }, 
      providers: [
        { ...mpA, upstream: failedUp },
        { ...mpB, upstream: storedUps.find(r => r.id === 'upstream-b')! }
      ] 
    },
    now,
  )
  assert.deepEqual(
    duringCooldown.map((candidate) => candidate.id),
    ['provider-b'],
    'the failed provider is skipped while alternatives remain',
  )

  // Manually expire cooldown
  await db.prepare("UPDATE freellm_upstream_providers SET status = 'live', cooldown_until = ? WHERE id = ?")
    .bind(now - 1, 'upstream-a')
    .run()
  
  const afterCooldown = await resolveCandidates(
    env,
    { 
      model: { ...testModel, routing: 'failover' }, 
      providers: [
        { ...mpA, upstream: { ...failedUp, status: 'live', cooldown_until: null } },
        { ...mpB, upstream: storedUps.find(r => r.id === 'upstream-b')! }
      ]
    },
    now,
  )
  assert.deepEqual(
    afterCooldown.map((candidate) => candidate.id),
    ['provider-a', 'provider-b'],
    'the provider becomes eligible again after 30 minutes',
  )

  await db
    .prepare("UPDATE freellm_upstream_providers SET status = 'down', cooldown_until = ? WHERE id = ?")
    .bind(now + FAILED_PROVIDER_COOLDOWN_MS, 'upstream-a')
    .run()
  await recordOutcome(env, 'upstream-a', 'provider-a', { ok: true, latencyMs: 12 })
  const recovered = (await storedUpstreamProviders()).find((row) => row.id === 'upstream-a')
  assert.equal(recovered?.status, 'live')
  assert.equal(recovered?.cooldown_until, null)
})

test('openStreamingCall tries the next provider after an upstream refusal', async () => {
  const key = Buffer.alloc(32).toString('base64')
  const env = { DB: db, ENCRYPTION_KEY: key } as unknown as Bindings
  const now = Date.now()
  
  await db.prepare(
    `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
     VALUES ('model_failover', 'failover-model', 'Failover Model', '[]', 2000, 'failover', 1, 0, ?, ?)`,
  ).bind(now, now).run()

  const upA = await createUpstreamProvider('upstream-fail-a', { base_url: 'https://a.example/v1', encryptionKey: key })
  const upB = await createUpstreamProvider('upstream-fail-b', { base_url: 'https://b.example/v1', encryptionKey: key })
  
  const mpA = await createModelProvider('fail-a', 'upstream-fail-a', 0)
  const mpB = await createModelProvider('fail-b', 'upstream-fail-b', 1)

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
        providers: [
          { ...mpA, upstream: upA },
          { ...mpB, upstream: upB },
        ],
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
  
  const upSlow = await createUpstreamProvider('upstream-slow', { avg_latency_ms: 5000 })
  const upFast = await createUpstreamProvider('upstream-fast', { avg_latency_ms: 200 })
  const upUnknown = await createUpstreamProvider('upstream-unknown', { avg_latency_ms: null })
  const upMid = await createUpstreamProvider('upstream-mid', { avg_latency_ms: 800 })
  
  const mpSlow = await createModelProvider('slow', 'upstream-slow', 0)
  const mpFast = await createModelProvider('fast', 'upstream-fast', 0)
  const mpUnknown = await createModelProvider('unknown', 'upstream-unknown', 0)
  const mpMid = await createModelProvider('mid', 'upstream-mid', 1)
  
  const candidates = await resolveCandidates(
    env,
    { 
      model: { ...testModel, routing: 'latency_weighted' }, 
      providers: [
        { ...mpSlow, upstream: upSlow },
        { ...mpFast, upstream: upFast },
        { ...mpUnknown, upstream: upUnknown },
        { ...mpMid, upstream: upMid },
      ] 
    },
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
  
  const upCooling = await createUpstreamProvider('upstream-fast-cooling', { 
    avg_latency_ms: 50, 
    cooldown_until: now + FAILED_PROVIDER_COOLDOWN_MS 
  })
  const upSlow = await createUpstreamProvider('upstream-slow-rested', { avg_latency_ms: 4000 })
  
  const mpCooling = await createModelProvider('fast-cooling', 'upstream-fast-cooling', 0)
  const mpSlow = await createModelProvider('slow-rested', 'upstream-slow-rested', 0)
  
  const candidates = await resolveCandidates(
    env,
    { 
      model: { ...testModel, routing: 'latency_weighted' }, 
      providers: [
        { ...mpCooling, upstream: upCooling },
        { ...mpSlow, upstream: upSlow },
      ] 
    },
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
  
  const upA = await createUpstreamProvider('upstream-a', { avg_latency_ms: 100 })
  const upB = await createUpstreamProvider('upstream-b', { avg_latency_ms: 200 })
  const upCooling = await createUpstreamProvider('upstream-cooling', { 
    avg_latency_ms: 10, 
    cooldown_until: now + FAILED_PROVIDER_COOLDOWN_MS 
  })
  
  const mpA = await createModelProvider('a', 'upstream-a', 0)
  const mpB = await createModelProvider('b', 'upstream-b', 0)
  const mpCooling = await createModelProvider('cooling', 'upstream-cooling', 0)
  
  const first = await resolveCandidates(
    env,
    { 
      model: { ...testModel, routing: 'latency_weighted' }, 
      providers: [
        { ...mpA, upstream: upA },
        { ...mpB, upstream: upB },
        { ...mpCooling, upstream: upCooling },
      ] 
    },
    now,
    { random: () => 0 },
  )
  assert.deepEqual(first.map((c) => c.id), ['b', 'a'])
  const second = await resolveCandidates(
    env,
    { 
      model: { ...testModel, routing: 'latency_weighted' }, 
      providers: [
        { ...mpA, upstream: upA },
        { ...mpB, upstream: upB },
        { ...mpCooling, upstream: upCooling },
      ] 
    },
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

test('recordOutcome: provider cooldown_base_ms overrides the global base', async () => {
  const env = { DB: db } as unknown as Bindings
  const day = 24 * 60 * 60 * 1000
  
  await createUpstreamProvider('upstream-cooldown-custom', { cooldown_base_ms: day })
  await createModelProvider('cooldown-custom', 'upstream-cooldown-custom', 0)

  const before = Date.now()
  await recordOutcome(env, 'upstream-cooldown-custom', 'cooldown-custom', { ok: false, latencyMs: 10, error: 'quota exhausted' })
  
  const row = (await db.prepare('SELECT consecutive_failures, cooldown_until FROM freellm_upstream_providers WHERE id = ?')
    .bind('upstream-cooldown-custom')
    .first<{ consecutive_failures: number; cooldown_until: number }>())!
  assert.equal(row.consecutive_failures, 1)
  assert.ok(row.cooldown_until >= before + day)
  assert.ok(row.cooldown_until <= Date.now() + day + 5000)
})

test('sortByLatency breaks EWMA ties by priority', () => {
  const up0 = upstreamProviderRow('up0', { avg_latency_ms: 300 })
  const up5 = upstreamProviderRow('up5', { avg_latency_ms: 300 })
  
  const mp0 = providerRow('p0', 'up0', 0)
  const mp5 = providerRow('p1', 'up5', 5)
  
  assert.deepEqual(
    sortByLatency([{ ...mp0, upstream: up0 }, { ...mp5, upstream: up5 }]).map((c) => c.id),
    ['p0', 'p1'],
  )
})

test('slow configs are skipped while live configs are rested', async () => {
  const store = kvMock()
  const env = { DB: db, freellm_sessions: store } as unknown as Bindings
  const now = Date.now()
  
  const upSlow = await createUpstreamProvider('upstream-slow', { status: 'slow', avg_latency_ms: 9000 })
  const upLive = await createUpstreamProvider('upstream-live', { status: 'live', avg_latency_ms: 5000 })
  
  const mpSlow = await createModelProvider('slow', 'upstream-slow', 0)
  const mpLive = await createModelProvider('live', 'upstream-live', 0)
  
  const candidates = await resolveCandidates(
    env,
    { 
      model: { ...testModel, routing: 'failover' }, 
      providers: [
        { ...mpSlow, upstream: upSlow },
        { ...mpLive, upstream: upLive },
      ] 
    },
    now,
  )
  assert.deepEqual(candidates.map((c) => c.id), ['live'])
})

test('all-slow pool is still usable when nothing better exists', async () => {
  const store = kvMock()
  const env = { DB: db, freellm_sessions: store } as unknown as Bindings
  const now = Date.now()
  
  const upSlowA = await createUpstreamProvider('upstream-slow-a', { status: 'slow', avg_latency_ms: 9000 })
  const upSlowB = await createUpstreamProvider('upstream-slow-b', { status: 'slow', avg_latency_ms: 9500 })
  
  const mpSlowA = await createModelProvider('slow-a', 'upstream-slow-a', 1)
  const mpSlowB = await createModelProvider('slow-b', 'upstream-slow-b', 0)
  
  const candidates = await resolveCandidates(
    env,
    { 
      model: { ...testModel, routing: 'failover' }, 
      providers: [
        { ...mpSlowA, upstream: upSlowA },
        { ...mpSlowB, upstream: upSlowB },
      ] 
    },
    now,
  )
  assert.deepEqual(candidates.map((c) => c.id), ['slow-b', 'slow-a'])
})

test('consecutive failures back off exponentially up to the cap', async () => {
  const env = { DB: db } as unknown as Bindings
  const now = Date.now()
  
  await db.prepare(
    `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
     VALUES ('model_backoff', 'backoff-model', 'Backoff Model', '[]', 2000, 'failover', 1, 0, ?, ?)`,
  ).bind(now, now).run()
  
  await createUpstreamProvider('upstream-backoff-a')
  await createModelProvider('backoff-a', 'upstream-backoff-a', 0)

  const before1 = Date.now()
  await recordOutcome(env, 'upstream-backoff-a', 'backoff-a', { ok: false, latencyMs: 10, error: 'boom' })
  
  const after1 = (await db.prepare('SELECT consecutive_failures, cooldown_until FROM freellm_upstream_providers WHERE id = ?')
    .bind('upstream-backoff-a')
    .first<{ consecutive_failures: number; cooldown_until: number }>())!
  assert.equal(after1.consecutive_failures, 1)
  assert.ok(after1.cooldown_until >= before1 + FAILED_PROVIDER_COOLDOWN_MS)
  assert.ok(after1.cooldown_until <= Date.now() + FAILED_PROVIDER_COOLDOWN_MS + 5000)

  // Reset cooldown so the second failure can be recorded, keeping the failure count.
  await db.prepare('UPDATE freellm_upstream_providers SET cooldown_until = NULL WHERE id = ?').bind('upstream-backoff-a').run()
  const before2 = Date.now()
  await recordOutcome(env, 'upstream-backoff-a', 'backoff-a', { ok: false, latencyMs: 10, error: 'boom' })
  
  const after2 = (await db.prepare('SELECT consecutive_failures, cooldown_until FROM freellm_upstream_providers WHERE id = ?')
    .bind('upstream-backoff-a')
    .first<{ consecutive_failures: number; cooldown_until: number }>())!
  assert.equal(after2.consecutive_failures, 2)
  assert.ok(after2.cooldown_until >= before2 + FAILED_PROVIDER_COOLDOWN_MS * 2 - 5000)
  assert.ok(after2.cooldown_until <= Date.now() + MAX_PROVIDER_COOLDOWN_MS + 5000)
})