import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import { canAccessModel, parseTier, tierGatedMessage, tierRank } from '../functions/lib/tiers'
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

test('migration defaults both tier columns to free', async () => {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
       VALUES ('model_tier_default', 'tier-default', 'Tier Default', '[]', 2000, 'round_robin', 1, 0, ?, ?)`,
    )
    .bind(now, now)
    .run()
  const model = await db
    .prepare('SELECT access_tier FROM freellm_models WHERE id = ?')
    .bind('model_tier_default')
    .first<{ access_tier: string }>()
  assert.equal(model?.access_tier, 'free')

  await db
    .prepare(
      `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, created_at, updated_at)
       VALUES ('user_tier_default', 'tier@example.com', 'tieruser', NULL, 'tiercode1', 0, 'user', 1, ?, ?)`,
    )
    .bind(now, now)
    .run()
  const user = await db
    .prepare('SELECT tier FROM freellm_users WHERE id = ?')
    .bind('user_tier_default')
    .first<{ tier: string }>()
  assert.equal(user?.tier, 'free')
})

test('tierRank orders free < pro < enterprise', () => {
  assert.ok(tierRank('free') < tierRank('pro'))
  assert.ok(tierRank('pro') < tierRank('enterprise'))
})

test('parseTier falls back to free on junk', () => {
  assert.equal(parseTier('pro'), 'pro')
  assert.equal(parseTier('enterprise'), 'enterprise')
  assert.equal(parseTier('ultra'), 'free')
  assert.equal(parseTier(null), 'free')
  assert.equal(parseTier(undefined), 'free')
})

test('canAccessModel: free alias is open to every tier', () => {
  for (const tier of ['free', 'pro', 'enterprise'] as const) {
    assert.equal(canAccessModel({ tier, role: 'user' }, { access_tier: 'free' }), true)
  }
})

test('canAccessModel: pro alias (e.g. gpt-luna) is locked for free tier', () => {
  assert.equal(canAccessModel({ tier: 'free', role: 'user' }, { access_tier: 'pro' }), false)
  assert.equal(canAccessModel({ tier: 'pro', role: 'user' }, { access_tier: 'pro' }), true)
  assert.equal(canAccessModel({ tier: 'enterprise', role: 'user' }, { access_tier: 'pro' }), true)
})

test('canAccessModel: enterprise alias needs enterprise', () => {
  assert.equal(canAccessModel({ tier: 'pro', role: 'user' }, { access_tier: 'enterprise' }), false)
  assert.equal(canAccessModel({ tier: 'enterprise', role: 'user' }, { access_tier: 'enterprise' }), true)
})

test('canAccessModel: admins bypass every gate', () => {
  for (const access of ['free', 'pro', 'enterprise'] as const) {
    assert.equal(canAccessModel({ tier: 'free', role: 'admin' }, { access_tier: access }), true)
  }
})

test('canAccessModel: unknown alias tier denies by default', () => {
  assert.equal(canAccessModel({ tier: 'enterprise', role: 'user' }, { access_tier: 'ultra' }), false)
  assert.equal(canAccessModel({ tier: 'enterprise', role: 'user' }, {}), false)
})

test('tierGatedMessage names the required tier', () => {
  assert.match(tierGatedMessage({ label: 'gpt-luna', access_tier: 'pro' }), /pro/)
  assert.match(tierGatedMessage({ label: 'gpt-luna', access_tier: 'pro' }), /gpt-luna/)
})
