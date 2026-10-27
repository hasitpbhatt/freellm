// One-off admin grants with optional expiry ("timer").
// Covers: migration 0032 schema, input validation, the expiry sweep
// (full/partial clawback, idempotency, no-expiry grants untouched), and the
// exact SQL contract the grant route runs (balance bump + ledger + grant row
// in one batch).

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import { createTestDb } from './helpers/db'
import {
  ADMIN_GRANT_MAX_CREDITS,
  expireAdminGrants,
  validateAdminGrantInput,
} from '../functions/lib/credit-grants'

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

let userSeq = 0
async function seedUser(balance: number): Promise<string> {
  userSeq += 1
  const id = `grant_user_${userSeq}`
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, tier, role, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, 'free', 'user', 1, ?, ?)`,
    )
    .bind(id, `${id}@test.com`, id, `ref_${id}`, balance, now, now)
    .run()
  return id
}

async function balanceOf(userId: string): Promise<number> {
  const row = await db.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?').bind(userId).first<{ balance_credits: number }>()
  return row?.balance_credits ?? -1
}

test('migration 0032: admin grants table exists and ledger accepts grant_expiry', async () => {
  const cols = await db.prepare('PRAGMA table_info(freellm_admin_grants)').all<{ name: string }>()
  const names = new Set(cols.results.map((c) => c.name))
  for (const name of ['id', 'user_id', 'credits', 'expires_at', 'expired_at', 'note', 'created_by', 'created_at']) {
    assert.ok(names.has(name), `freellm_admin_grants has ${name}`)
  }
  const userId = await seedUser(0)
  const now = Date.now()
  await db
    .prepare(`INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at) VALUES ('lge1', ?, -100, 'grant_expiry', '{}', ?)`)
    .bind(userId, now)
    .run()
  const row = await db.prepare('SELECT reason FROM freellm_credit_ledger WHERE id = ?').bind('lge1').first<{ reason: string }>()
  assert.equal(row?.reason, 'grant_expiry')
})

test('validateAdminGrantInput: accepts valid bodies', () => {
  const now = Date.now()
  assert.deepEqual(validateAdminGrantInput({ credits: 50000 }, now), {
    input: { credits: 50000, expiresAt: null, note: null },
  })
  const withTimer = validateAdminGrantInput({ credits: 100, expires_at: now + 3_600_000, note: '  contest winner ' }, now)
  assert.ok('input' in withTimer)
  if ('input' in withTimer) {
    assert.equal(withTimer.input.credits, 100)
    assert.equal(withTimer.input.expiresAt, now + 3_600_000)
    assert.equal(withTimer.input.note, 'contest winner')
  }
  const iso = validateAdminGrantInput({ credits: 100, expires_at: new Date(now + 86_400_000).toISOString() }, now)
  assert.ok('input' in iso && iso.input.expiresAt !== null && iso.input.expiresAt > now)
})

test('validateAdminGrantInput: rejects bad credits and bad timers', () => {
  const now = Date.now()
  for (const credits of [0, -5, 1.5, ADMIN_GRANT_MAX_CREDITS + 1, 'lots', undefined, true]) {
    const result = validateAdminGrantInput({ credits }, now)
    assert.ok('error' in result, `credits=${String(credits)} rejected`)
  }
  assert.ok('error' in validateAdminGrantInput({ credits: 100, expires_at: now - 1000 }, now), 'past expiry rejected')
  assert.ok('error' in validateAdminGrantInput({ credits: 100, expires_at: now }, now), 'now expiry rejected')
  assert.ok(
    'error' in validateAdminGrantInput({ credits: 100, expires_at: now + 367 * 24 * 3_600_000 }, now),
    'far-future expiry rejected',
  )
  assert.ok('error' in validateAdminGrantInput({ credits: 100, expires_at: 'not-a-date' }, now), 'garbage expiry rejected')
})

test('grant route contract: one batch bumps balance, writes ledger + grant row', async () => {
  const userId = await seedUser(1000)
  const now = Date.now()
  const expiresAt = now + 7 * 24 * 3_600_000
  // The exact statements POST /api/admin/users/:id/grant runs.
  await db.batch([
    db.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?').bind(5000, now, userId),
    db.prepare(`INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at) VALUES (?, ?, ?, 'admin_grant', ?, ?)`).bind(
      'ledger_grant_1', userId, 5000, JSON.stringify({ grant_id: 'g1', admin_id: 'admin1', note: 'test', expires_at: expiresAt }), now,
    ),
    db.prepare(`INSERT INTO freellm_admin_grants (id, user_id, credits, expires_at, expired_at, note, created_by, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`).bind(
      'g1', userId, 5000, expiresAt, 'test', 'admin1', now,
    ),
  ])
  assert.equal(await balanceOf(userId), 6000)
  const grant = await db.prepare('SELECT * FROM freellm_admin_grants WHERE id = ?').bind('g1').first<{ credits: number; expires_at: number; expired_at: null }>()
  assert.equal(grant?.credits, 5000)
  assert.equal(grant?.expires_at, expiresAt)
  assert.equal(grant?.expired_at, null)
  const ledger = await db.prepare('SELECT reason, delta FROM freellm_credit_ledger WHERE id = ?').bind('ledger_grant_1').first<{ reason: string; delta: number }>()
  assert.deepEqual(ledger, { reason: 'admin_grant', delta: 5000 })
})

test('expireAdminGrants: fully unspent timed grant is clawed back once', async () => {
  const userId = await seedUser(2000)
  const now = Date.now()
  await db.prepare(
    `INSERT INTO freellm_admin_grants (id, user_id, credits, expires_at, expired_at, note, created_by, created_at)
     VALUES ('g_expire_full', ?, 2000, ?, NULL, NULL, 'admin1', ?)`,
  ).bind(userId, now - 1000, now - 2000).run()

  const clawed = await expireAdminGrants(db, userId, now)
  assert.equal(clawed, 2000)
  assert.equal(await balanceOf(userId), 0)
  const grant = await db.prepare('SELECT expired_at FROM freellm_admin_grants WHERE id = ?').bind('g_expire_full').first<{ expired_at: number }>()
  assert.equal(grant?.expired_at, now)
  const ledger = await db.prepare(`SELECT delta, reason FROM freellm_credit_ledger WHERE reason = 'grant_expiry' AND user_id = ?`).bind(userId).all<{ delta: number; reason: string }>()
  assert.equal(ledger.results.length, 1)
  assert.equal(ledger.results[0].delta, -2000)

  // Idempotent: a second sweep finds nothing to claw.
  assert.equal(await expireAdminGrants(db, userId, now + 1000), 0)
  assert.equal(await balanceOf(userId), 0)
})

test('expireAdminGrants: partially spent grant claws only the remainder', async () => {
  const userId = await seedUser(0)
  const now = Date.now()
  await db.prepare(
    `INSERT INTO freellm_admin_grants (id, user_id, credits, expires_at, expired_at, note, created_by, created_at)
     VALUES ('g_expire_part', ?, 5000, ?, NULL, NULL, 'admin1', ?)`,
  ).bind(userId, now - 1000, now - 2000).run()
  // Simulate the user spending 4000 of the 5000 before the timer ended.
  await db.prepare('UPDATE freellm_users SET balance_credits = 1000 WHERE id = ?').bind(userId).run()

  assert.equal(await expireAdminGrants(db, userId, now), 1000)
  assert.equal(await balanceOf(userId), 0)
})

test('expireAdminGrants: leaves live and never-expiring grants alone', async () => {
  const userId = await seedUser(7000)
  const now = Date.now()
  await db.prepare(
    `INSERT INTO freellm_admin_grants (id, user_id, credits, expires_at, expired_at, note, created_by, created_at)
     VALUES ('g_live', ?, 3000, ?, NULL, NULL, 'admin1', ?)`,
  ).bind(userId, now + 86_400_000, now).run()
  await db.prepare(
    `INSERT INTO freellm_admin_grants (id, user_id, credits, expires_at, expired_at, note, created_by, created_at)
     VALUES ('g_forever', ?, 4000, NULL, NULL, NULL, 'admin1', ?)`,
  ).bind(userId, now).run()

  assert.equal(await expireAdminGrants(db, userId, now), 0)
  assert.equal(await balanceOf(userId), 7000)
})
