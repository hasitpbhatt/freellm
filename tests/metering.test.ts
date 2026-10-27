import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeSpendable,
  estimateReserve,
  placeHold,
  settleRequest,
  type Usage,
} from '../functions/lib/metering'
import { createTestDb, readBalances, seedUser, testModel } from './helpers/db'
import type { D1Database } from '@cloudflare/workers-types'

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

const USAGE: Usage = { input: 30, output: 70, total: 100 }

async function settle(userId: string, requestId: string, extra: Record<string, unknown> = {}) {
  return settleRequest(db, {
    userId,
    requestId,
    model: testModel,
    providerLabel: 'test-provider',
    settlement: { kind: 'completed', usage: USAGE },
    latencyMs: 12,
    ...extra,
  })
}

// ------------------------------------------------------------- estimateReserve

test('estimateReserve: input estimate (chars/4 + 4/msg) + max output', () => {
  assert.equal(estimateReserve([{ content: 'abcd' }], 4096), 1 + 4 + 4096)
  assert.equal(estimateReserve([{ content: '' }, { content: '' }], 0), 0 + 8)
  assert.equal(estimateReserve([{ content: 'x'.repeat(400) }], 100), 100 + 4 + 100)
})

// ------------------------------------------------------------ computeSpendable

test('computeSpendable: global + scoped, minus outstanding holds', async () => {
  const userId = await seedUser(db, { balanceCredits: 10_000, scopedCredits: 5_000 })
  const free = await computeSpendable(db, userId, 10_000, 'model_test')
  assert.equal(free.global, 10_000)
  assert.equal(free.scoped, 5_000)
  assert.equal(free.total, 15_000)
  assert.equal(free.available, 15_000)

  await placeHold(db, userId, 'req-hold', 4_000)
  const held = await computeSpendable(db, userId, 10_000, 'model_test')
  assert.equal(held.held, 4_000)
  assert.equal(held.available, 11_000)

  // the request can exclude its own hold when re-checking mid-flight
  const own = await computeSpendable(db, userId, 10_000, 'model_test', 'req-hold')
  assert.equal(own.available, 15_000)
})

// ---------------------------------------------------------------- settle math

test('settle: reported usage charges exactly the reported total, scoped first', async () => {
  const userId = await seedUser(db, { balanceCredits: 1_000, scopedCredits: 40 })
  const result = await settle(userId, 'req-1')

  assert.equal(result.creditsCharged, 100)
  assert.equal(result.source, 'reported')
  assert.equal(result.status, 'completed')
  assert.equal(result.alreadySettled, false)
  assert.deepEqual(result.balance, { global: 940, scoped: 0 }, 'scoped drains before global')

  const ledger = await db
    .prepare("SELECT delta, reason FROM freellm_credit_ledger WHERE user_id = ? AND reason = 'chat_spend'")
    .bind(userId)
    .first<{ delta: number; reason: string }>()
  assert.equal(ledger?.delta, -60, 'ledger records only the global portion; the scoped part lives in the grant')

  const holds = await db.prepare('SELECT * FROM freellm_credit_holds WHERE request_id = ?').bind('req-1').first()
  assert.equal(holds, null, 'settlement releases the hold')
})

test('settle: no usage block falls back to the alias flat rate', async () => {
  const userId = await seedUser(db, { balanceCredits: 5_000 })
  const result = await settleRequest(db, {
    userId,
    requestId: 'req-flat',
    model: testModel,
    providerLabel: 'test-provider',
    settlement: { kind: 'completed', usage: null },
    latencyMs: 5,
  })
  assert.equal(result.creditsCharged, testModel.flat_rate_credits)
  assert.equal(result.source, 'flat_rate')
  assert.deepEqual(await readBalances(db, userId), { global: 3_000, scoped: 0 })
})

test('settle: aborted stream charges the flat rate and records aborted', async () => {
  const userId = await seedUser(db, { balanceCredits: 5_000 })
  const result = await settleRequest(db, {
    userId,
    requestId: 'req-abort',
    model: testModel,
    providerLabel: 'test-provider',
    settlement: { kind: 'aborted', reason: 'client disconnected' },
    latencyMs: 5,
  })
  assert.equal(result.creditsCharged, testModel.flat_rate_credits)
  assert.equal(result.status, 'aborted')
  assert.deepEqual(await readBalances(db, userId), { global: 3_000, scoped: 0 })
})

test('settle: failed upstream charges nothing', async () => {
  const userId = await seedUser(db, { balanceCredits: 5_000 })
  const result = await settleRequest(db, {
    userId,
    requestId: 'req-fail',
    model: testModel,
    providerLabel: 'all-configs-failed',
    settlement: { kind: 'failed', reason: '502 upstream' },
    latencyMs: 5,
  })
  assert.equal(result.creditsCharged, 0)
  assert.equal(result.status, 'failed')
  assert.deepEqual(await readBalances(db, userId), { global: 5_000, scoped: 0 })
})

test('settle: BYOK (free) is recorded but never touches balances or ledger', async () => {
  const userId = await seedUser(db, { balanceCredits: 5_000, scopedCredits: 100 })
  const result = await settleRequest(db, {
    userId,
    requestId: 'req-byok',
    model: testModel,
    providerLabel: 'my-key',
    settlement: { kind: 'completed', usage: USAGE },
    latencyMs: 5,
    usage: USAGE,
    free: true,
  })
  assert.equal(result.creditsCharged, 0)
  assert.equal(result.source, 'reported')
  assert.equal(result.status, 'completed')

  const event = await db
    .prepare('SELECT credits_charged, key_mode FROM freellm_usage_events WHERE request_id = ?')
    .bind('req-byok')
    .first<{ credits_charged: number; key_mode: string }>()
  assert.equal(event?.key_mode, 'byok')
  assert.equal(event?.credits_charged, 0)

  assert.deepEqual(await readBalances(db, userId), { global: 5_000, scoped: 100 })
  const ledger = await db.prepare('SELECT COUNT(*) AS n FROM freellm_credit_ledger').first<{ n: number }>()
  assert.equal(ledger?.n, 0, 'no ledger rows for free requests')
})

test('settle: BYOK (free) failures are also recorded as BYOK', async () => {
  const userId = await seedUser(db, { balanceCredits: 5_000, scopedCredits: 100 })
  const result = await settleRequest(db, {
    userId,
    requestId: 'req-byok-failed',
    model: testModel,
    providerLabel: 'my-key',
    settlement: { kind: 'failed', reason: '502 upstream' },
    latencyMs: 5,
    free: true,
  })
  assert.equal(result.creditsCharged, 0)
  assert.equal(result.status, 'failed')

  const event = await db
    .prepare('SELECT credits_charged, key_mode, status FROM freellm_usage_events WHERE request_id = ?')
    .bind('req-byok-failed')
    .first<{ credits_charged: number; key_mode: string; status: string }>()
  assert.equal(event?.key_mode, 'byok')
  assert.equal(event?.credits_charged, 0)
  assert.equal(event?.status, 'failed')
  assert.deepEqual(await readBalances(db, userId), { global: 5_000, scoped: 100 })
})

// ---------------------------------------------------------------- idempotency

test('settle: retrying the same request_id never double-charges', async () => {
  const userId = await seedUser(db, { balanceCredits: 1_000 })
  const first = await settle(userId, 'req-idem')
  assert.equal(first.creditsCharged, 100)

  const second = await settleRequest(db, {
    userId,
    requestId: 'req-idem',
    model: testModel,
    providerLabel: 'test-provider',
    settlement: { kind: 'completed', usage: null }, // different payload, same request
    latencyMs: 5,
  })
  assert.equal(second.alreadySettled, true)
  assert.equal(second.creditsCharged, 100, 'original charge is replayed')
  assert.equal(second.source, 'reported')
  assert.deepEqual(await readBalances(db, userId), { global: 900, scoped: 0 })
})

test('settle: battle spend is attributed to the battle id', async () => {
  const userId = await seedUser(db, { balanceCredits: 5_000 })
  await db
    .prepare('INSERT INTO freellm_battles (id, user_id, prompt, models, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind('battle_1', userId, 'best model?', '["test-model"]', 'complete', Date.now())
    .run()
  await settle(userId, 'req-battle', { battleId: 'battle_1' })
  const event = await db
    .prepare('SELECT battle_id FROM freellm_usage_events WHERE request_id = ?')
    .bind('req-battle')
    .first<{ battle_id: string }>()
  assert.equal(event?.battle_id, 'battle_1')
})

test('settle: a charge beyond the balance throws instead of going negative', async () => {
  const userId = await seedUser(db, { balanceCredits: 10 })
  await placeHold(db, userId, 'req-broke', 500)
  await assert.rejects(
    () =>
      settleRequest(db, {
        userId,
        requestId: 'req-broke',
        model: testModel,
        providerLabel: 'test-provider',
        settlement: { kind: 'completed', usage: { input: 0, output: 0, total: 500 } },
        latencyMs: 5,
      }),
    /insufficient credits at settlement/,
  )
  const hold = await db
    .prepare('SELECT request_id FROM freellm_credit_holds WHERE request_id = ?')
    .bind('req-broke')
    .first()
  assert.equal(hold, null, 'hold is released even when settlement throws')
})

test('settle: hostile provider usage falls back to flat rate', async () => {
  const userId = await seedUser(db, { balanceCredits: 10_000 })
  for (const bad of [
    { input: -1, output: 5, total: 4 },
    { input: 5, output: 5, total: Number.NaN },
    { input: 5.5, output: 5, total: 10 },
    { input: 1, output: 1, total: 1_000_000 },
  ]) {
    const result = await settleRequest(db, {
      userId,
      requestId: `req-bad-${bad.input}-${bad.total}`,
      model: testModel,
      providerLabel: 'evil-provider',
      settlement: { kind: 'completed', usage: bad as Usage },
      latencyMs: 5,
    })
    assert.equal(result.source, 'flat_rate')
    assert.equal(result.creditsCharged, testModel.flat_rate_credits)
  }
})

test('settle: free aborted stays aborted with zero charge', async () => {
  const userId = await seedUser(db, { balanceCredits: 5_000 })
  const result = await settleRequest(db, {
    userId,
    requestId: 'req-free-abort',
    model: testModel,
    providerLabel: 'byok:key',
    settlement: { kind: 'aborted', reason: 'client disconnected' },
    latencyMs: 5,
    free: true,
  })
  assert.equal(result.status, 'aborted')
  assert.equal(result.creditsCharged, 0)
})

test('settle: scoped-only never touches global balance', async () => {
  const userId = await seedUser(db, { balanceCredits: 10_000, scopedCredits: 500 })
  const model = { ...testModel, scoped_only: 1 }
  const result = await settleRequest(db, {
    userId,
    requestId: 'req-scoped-only',
    model,
    providerLabel: 'luna-provider',
    settlement: { kind: 'completed', usage: { input: 10, output: 20, total: 100 } },
    latencyMs: 5,
  })
  assert.equal(result.creditsCharged, 100)
  assert.equal(result.source, 'reported')
  assert.deepEqual(await readBalances(db, userId), { global: 10_000, scoped: 400 })
})

test('settle: scoped-only with short scoped balance throws without charging global', async () => {
  const userId = await seedUser(db, { balanceCredits: 10_000, scopedCredits: 40 })
  const model = { ...testModel, scoped_only: 1 }
  await placeHold(db, userId, 'req-scoped-short', 500)
  await assert.rejects(
    () =>
      settleRequest(db, {
        userId,
        requestId: 'req-scoped-short',
        model,
        providerLabel: 'luna-provider',
        settlement: { kind: 'completed', usage: { input: 0, output: 0, total: 500 } },
        latencyMs: 5,
      }),
    /insufficient credits at settlement/,
  )
  assert.deepEqual(await readBalances(db, userId), { global: 10_000, scoped: 40 })
})
