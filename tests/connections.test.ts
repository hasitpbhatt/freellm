import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import { createTestDb } from './helpers/db'
import type { Bindings, ConnectionRow } from '../functions/lib/types'
import { isExpired, listPersonalConnections, publicConnection, getUsableConnection, connectionSettleModel } from '../functions/lib/connections'

let db: D1Database
let dispose: () => Promise<void>
let env: Bindings

before(async () => {
  const created = await createTestDb()
  db = created.db
  dispose = created.dispose
  env = { DB: db } as unknown as Bindings
})

after(async () => {
  if (dispose) await dispose()
})

test('migrations: freellm_connections is the unified vault', async () => {
  const columns = await db.prepare('PRAGMA table_info(freellm_connections)').all<{ name: string }>()
  const names = new Set(columns.results.map((column) => column.name))
  for (const name of [
    'id',
    'owner_id',
    'scope',
    'provider',
    'label',
    'base_url',
    'upstream_model',
    'key_ciphertext',
    'key_iv',
    'auth_kind',
    'protocol',
    'account_id',
    'refresh_ciphertext',
    'refresh_iv',
    'expires_at',
    'active',
    'created_at',
  ]) {
    assert.equal(names.has(name), true, `missing freellm_connections.${name}`)
  }
})

test('migrations: api tokens can bind to a connection', async () => {
  const columns = await db.prepare('PRAGMA table_info(freellm_api_tokens)').all<{ name: string }>()
  const names = new Set(columns.results.map((column) => column.name))
  assert.equal(names.has('connection_id'), true, 'missing freellm_api_tokens.connection_id')
})

/** Inserts a personal connection directly and returns the row. */
async function insertConnection(overrides: Partial<ConnectionRow> & { id: string }): Promise<void> {
  const now = Date.now()
  const row: ConnectionRow = {
    id: overrides.id,
    owner_id: overrides.owner_id ?? null,
    scope: overrides.scope ?? 'personal',
    provider: overrides.provider ?? 'byok',
    label: overrides.label ?? 'Test connection',
    base_url: overrides.base_url ?? 'https://api.example.com/v1',
    upstream_model: overrides.upstream_model ?? 'test-model',
    key_ciphertext: overrides.key_ciphertext ?? 'ct',
    key_iv: overrides.key_iv ?? 'iv',
    auth_kind: overrides.auth_kind ?? 'api_key',
    protocol: overrides.protocol ?? 'openai',
    account_id: overrides.account_id ?? null,
    refresh_ciphertext: overrides.refresh_ciphertext ?? null,
    refresh_iv: overrides.refresh_iv ?? null,
    expires_at: overrides.expires_at ?? null,
    status: overrides.status ?? 'unknown',
    last_checked_at: overrides.last_checked_at ?? null,
    last_error: overrides.last_error ?? null,
    avg_latency_ms: overrides.avg_latency_ms ?? null,
    active: overrides.active ?? 1,
    messages_served: overrides.messages_served ?? 0,
    contributed: overrides.contributed ?? 0,
    contribution_reward_paid: overrides.contribution_reward_paid ?? 0,
    last_alive_at: overrides.last_alive_at ?? null,
    extra_headers_json: overrides.extra_headers_json ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  }
  await db
    .prepare(
      `INSERT INTO freellm_connections (id, owner_id, scope, provider, label, base_url, upstream_model,
        key_ciphertext, key_iv, auth_kind, protocol, account_id, refresh_ciphertext, refresh_iv, expires_at,
        status, last_checked_at, last_error, avg_latency_ms, active, messages_served,
        contributed, contribution_reward_paid, last_alive_at, extra_headers_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.owner_id,
      row.scope,
      row.provider,
      row.label,
      row.base_url,
      row.upstream_model,
      row.key_ciphertext,
      row.key_iv,
      row.auth_kind,
      row.protocol,
      row.account_id,
      row.refresh_ciphertext,
      row.refresh_iv,
      row.expires_at,
      row.status,
      row.last_checked_at,
      row.last_error,
      row.avg_latency_ms,
      row.active,
      row.messages_served,
      row.contributed,
      row.contribution_reward_paid,
      row.last_alive_at,
      row.extra_headers_json,
      row.created_at,
      row.updated_at,
    )
    .run()
}

test('listPersonalConnections returns the owner’s personal rows (disabled included), newest first', async () => {
  await insertConnection({ id: 'c-alice-1', owner_id: 'alice', created_at: 1 })
  await insertConnection({ id: 'c-alice-2', owner_id: 'alice', active: 0, created_at: 2 })
  await insertConnection({ id: 'c-bob-1', owner_id: 'bob', created_at: 3 })
  await insertConnection({ id: 'c-shared-1', owner_id: null, scope: 'shared', created_at: 4 })

  const mine = await listPersonalConnections(env, 'alice')
  const ids = mine.map((row) => row.id)
  assert.deepEqual(ids, ['c-alice-2', 'c-alice-1'], 'only own rows, newest first, disabled kept')
})

test('getUsableConnection allows your own rows and admin-shared rows, not others’', async () => {
  const own = await getUsableConnection(env, 'alice', 'c-alice-1')
  assert.equal(own?.id, 'c-alice-1')

  const shared = await getUsableConnection(env, 'alice', 'c-shared-1')
  assert.equal(shared?.id, 'c-shared-1', 'shared rows are usable by anyone')

  const foreign = await getUsableConnection(env, 'alice', 'c-bob-1')
  assert.equal(foreign, null, 'another user’s personal row is denied')

  const disabled = await getUsableConnection(env, 'alice', 'c-alice-2')
  assert.equal(disabled, null, 'disabled rows are denied')
})

test('isExpired only flags OAuth rows past their expiry', () => {
  const now = 1_000_000
  const base = { auth_kind: 'oauth', expires_at: now - 1 } as ConnectionRow
  assert.equal(isExpired(base, now), true)
  assert.equal(isExpired({ ...base, expires_at: now + 1 }, now), false)
  assert.equal(isExpired({ ...base, expires_at: null }, now), false)
  assert.equal(isExpired({ ...base, auth_kind: 'api_key' }, now), false)
})

test('publicConnection never leaks the secret material', async () => {
  await insertConnection({ id: 'c-secret', owner_id: 'alice', key_ciphertext: 'SUPER-SECRET-CT', key_iv: 'iv' })
  const rows = await listPersonalConnections(env, 'alice')
  const row = rows.find((r) => r.id === 'c-secret')
  assert.ok(row)
  const pub = publicConnection(row) as Record<string, unknown>
  assert.equal(JSON.stringify(pub).includes('SUPER-SECRET-CT'), false)
  assert.equal(pub.id, 'c-secret')
  assert.equal(pub.scope, 'personal')
  assert.equal(pub.has_refresh_token, false)
  assert.equal(pub.expired, false)
})

test('a disabled row reports status disabled rather than its stale health', async () => {
  await insertConnection({ id: 'c-off', owner_id: 'alice', active: 0, status: 'live' })
  const raw = await db.prepare('SELECT * FROM freellm_connections WHERE id = ?').bind('c-off').first<ConnectionRow>()
  assert.ok(raw)
  assert.equal(publicConnection(raw).status, 'disabled')
})

test('connectionSettleModel is a free, zero-cost stand-in keyed by the connection', () => {
  const model = connectionSettleModel('conn-1', 'grok-build')
  assert.equal(model.id, 'connection:conn-1')
  assert.equal(model.slug, 'grok-build')
  assert.equal(model.flat_rate_credits, 0)
  assert.equal(model.access_tier, 'free')
  assert.equal(model.scoped_only, 0)

  // An empty upstream model still yields a non-empty slug/label.
  const blank = connectionSettleModel('conn-2', '')
  assert.equal(blank.slug, 'byok')
  assert.equal(blank.label, 'Your connection')
})
