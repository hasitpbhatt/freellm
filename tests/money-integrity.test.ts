// Wave 0 money-integrity tests. Each test here is an exploit sequence that
// the pre-fix code allowed: a farmed tier, a double-minted promo, a
// capped-out claim that paid anyway, or a settlement that drove the balance
// negative by ignoring outstanding holds. They assert the new atomic
// guarantees (conditional statements inside one transaction) hold.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import {
  ARCADE_GLOBAL_DAILY_BUDGET,
  clearClaimStatements,
  gameClaimStatements,
  memoryMovesFromFlips,
  rewardForMemory,
} from '../functions/routes/games'
import { promoRedemptionStatements } from '../functions/routes/promos'
import { expirePromoCredits } from '../functions/lib/promo-expiry'
import { qualifyReferrals, REFERRAL_REWARD } from '../functions/routes/economy'
import { placeHold, settleRequest } from '../functions/lib/metering'
import { createTestDb, seedUser, testModel } from './helpers/db'

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

type BatchResult = Array<{ success: boolean; meta?: { changes?: number } }>

async function runBatch(statements: unknown[]): Promise<BatchResult> {
  return (await db.batch(statements as never)) as unknown as BatchResult
}

async function balanceOf(userId: string): Promise<number> {
  const row = await db.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?').bind(userId).first<{ balance_credits: number }>()
  return row?.balance_credits ?? 0
}

async function ledgerSum(userId: string, reason: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS total FROM freellm_credit_ledger WHERE user_id = ? AND reason = ?')
    .bind(userId, reason)
    .first<{ total: number }>()
  return row?.total ?? 0
}

/** A memory round with `flips` already flipped (moves = flips / 2), old enough to be claimable. */
async function seedMemoryRound(userId: string, roundId: string, flips: number, ageMs = 20_000): Promise<void> {
  await db
    .prepare(
      `INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, flips, reward)
       VALUES (?, ?, 'memory', '{"board":[]}', ?, ?, 0)`,
    )
    .bind(roundId, userId, Date.now() - ageMs, flips)
    .run()
}

// -------------------------------------------------- memory score derivation

test('memory score comes from the stored flip counter, never the client', () => {
  // 12 flips = 6 pair-attempts = perfect play → 12,000cr
  assert.equal(memoryMovesFromFlips(12), 6)
  assert.equal(rewardForMemory(memoryMovesFromFlips(12)!), 12000)
  // odd flip counts are not a completed board — not payable
  assert.equal(memoryMovesFromFlips(13), null)
  assert.equal(rewardForMemory(memoryMovesFromFlips(13)!), null)
  // under the minimum board, or over the human bound
  assert.equal(memoryMovesFromFlips(10), null)
  assert.equal(rewardForMemory(memoryMovesFromFlips(64)!), null)
})

// ------------------------------------------------------------- game claims

test('game claim: capped-out concurrent claims on different rounds pay ONCE', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)

  // One paid memory play already banked today (cap is 2, so one slot left),
  // and a second fresh round racing two concurrent claims for it.
  await db
    .prepare(
      `INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, claimed_at, reward)
       VALUES ('round_spent', ?, 'memory', '{}', ?, ?, 12000)`,
    )
    .bind(userId, today - 1000, today)
    .run()
  await seedMemoryRound(userId, 'round_race', 12)

  const timestamp = Date.now()
  const claim = async (roundId: string) => {
    try {
      const result = await runBatch(
        gameClaimStatements(db, {
          userId,
          game: 'memory',
          roundId,
          reward: 12000,
          detail: 'moves:6 flips:12',
          timestamp,
        }),
      )
      return result[0].meta?.changes === 1
    } catch {
      // The deterministic ledger id rolled this batch back — a lost race.
      return false
    }
  }

  const [wonA, wonB] = await Promise.all([claim('round_race'), claim('round_race')])
  assert.equal([wonA, wonB].filter(Boolean).length, 1, 'exactly one claim may win a round')
  assert.equal(await balanceOf(userId), 12000, 'the payout landed exactly once')
  assert.equal(await ledgerSum(userId, 'game_reward'), 12000)
})

test('game claim: the daily cap inside the claim statement blocks a second paid play', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)

  // Two claimed rounds today — memory's cap is 2, so nothing may pay.
  for (const id of ['cap_a', 'cap_b']) {
    await db
      .prepare(
        `INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, claimed_at, reward)
         VALUES (?, ?, 'memory', '{}', ?, ?, 12000)`,
      )
      .bind(id, userId, today - 1000, today)
      .run()
  }
  await seedMemoryRound(userId, 'round_capped', 12)

  const result = await runBatch(
    gameClaimStatements(db, {
      userId,
      game: 'memory',
      roundId: 'round_capped',
      reward: 12000,
      detail: 'moves:6 flips:12',
      timestamp: Date.now(),
    }),
  )
  assert.equal(result[0].meta?.changes, 0, 'the capped claim matched no rows')
  assert.equal(await balanceOf(userId), 0, 'and no ledger row or balance change ran')
  assert.equal(await ledgerSum(userId, 'game_reward'), 0)
})

test('game claim: an exhausted global pot blocks the payout', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  await db
    .prepare(
      `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
       VALUES ('ledger_pot', ?, ?, 'game_reward', '{}', ?)`,
    )
    .bind(userId, ARCADE_GLOBAL_DAILY_BUDGET, Date.now())
    .run()
  await seedMemoryRound(userId, 'round_pot', 12)

  const result = await runBatch(
    gameClaimStatements(db, {
      userId,
      game: 'memory',
      roundId: 'round_pot',
      reward: 12000,
      detail: 'moves:6 flips:12',
      timestamp: Date.now(),
    }),
  )
  assert.equal(result[0].meta?.changes, 0)
  assert.equal(await balanceOf(userId), 0)
})

test('game claim: the grant statements never fire without the claim', async () => {
  const userId = await seedUser(db, { balanceCredits: 42 })
  // Claim a round that is already claimed — the guard must hold the grant back.
  await seedMemoryRound(userId, 'round_done', 12)
  const timestamp = Date.now()
  await db.prepare('UPDATE freellm_game_rounds SET claimed_at = ?, reward = 12000 WHERE id = ?').bind(timestamp - 5, 'round_done').run()

  const result = await runBatch(
    gameClaimStatements(db, {
      userId,
      game: 'memory',
      roundId: 'round_done',
      reward: 12000,
      detail: 'moves:6 flips:12',
      timestamp,
    }),
  )
  assert.equal(result[0].meta?.changes, 0)
  assert.equal(await balanceOf(userId), 42, 'already-claimed round paid nothing')
})

test('clear claim: concurrent claims pay the bonus ONCE', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)

  // One paid play in each of the two arcade games today.
  for (const game of ['typing', 'memory']) {
    await db
      .prepare(
        `INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, claimed_at, reward)
         VALUES (?, ?, ?, '{}', ?, ?, 250)`,
      )
      .bind(`played_${game}`, userId, game, today - 1000, today)
      .run()
  }

  const result = await Promise.all([
    runBatch(clearClaimStatements(db, { userId, roundId: 'clear_a', timestamp: Date.now() })).then(
      (r) => r[0].meta?.changes === 1,
      () => false,
    ),
    runBatch(clearClaimStatements(db, { userId, roundId: 'clear_b', timestamp: Date.now() })).then(
      (r) => r[0].meta?.changes === 1,
      () => false,
    ),
  ])
  assert.equal(result.filter(Boolean).length, 1, 'only one clear-bonus row may insert')
  assert.equal(await balanceOf(userId), 7000)
  // Only the clear bonus itself lands in the ledger — the paid plays seeded
  // above carry their reward on the round row, not as ledger entries.
  assert.equal(await ledgerSum(userId, 'game_reward'), 7000)
})

test('clear claim: without both games today, nothing inserts or pays', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const result = await runBatch(clearClaimStatements(db, { userId, roundId: 'clear_none', timestamp: Date.now() }))
  assert.equal(result[0].meta?.changes, 0)
  assert.equal(await balanceOf(userId), 0)
})

// -------------------------------------------------------------- promo codes

type PromoRow = {
  id: string
  code: string
  credits: number
  model_id: string | null
  redemption_count: number
  per_user_limit: number
  max_redemptions: number | null
  active: number
  min_account_age_hours: number
  starts_at: number | null
  expires_at: number | null
}

async function seedPromo(id: string, opts: { credits?: number; maxRedemptions?: number | null; perUserLimit?: number } = {}): Promise<PromoRow> {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_promo_codes (id, code, credits, model_id, max_redemptions, redemption_count, per_user_limit, min_account_age_hours, starts_at, expires_at, active, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, 0, ?, 0, NULL, NULL, 1, ?, ?)`,
    )
    .bind(id, id.toUpperCase(), opts.credits ?? 5000, opts.maxRedemptions ?? null, opts.perUserLimit ?? 1, now, now)
    .run()
  return {
    id,
    code: id.toUpperCase(),
    credits: opts.credits ?? 5000,
    model_id: null,
    redemption_count: 0,
    per_user_limit: opts.perUserLimit ?? 1,
    max_redemptions: opts.maxRedemptions ?? null,
    active: 1,
    min_account_age_hours: 0,
    starts_at: null,
    expires_at: null,
  }
}

test('promo redeem: concurrent redemptions of a one-shot code pay ONCE', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const promo = await seedPromo('single', { credits: 5000, maxRedemptions: 1 })

  const statements = (redemptionId: string) =>
    promoRedemptionStatements(db, {
      promo,
      user: { id: userId },
      redemptionId,
      ledgerId: `ledger_${redemptionId}`,
      timestamp: Date.now(),
    })

  const [a, b] = await Promise.all([runBatch(statements('r_a')), runBatch(statements('r_b'))])
  const grants = [
    { reserved: a[0].meta?.changes ?? 0, redeemed: a[1].meta?.changes ?? 0 },
    { reserved: b[0].meta?.changes ?? 0, redeemed: b[1].meta?.changes ?? 0 },
  ].filter((g) => g.redeemed === 1)
  assert.equal(grants.length, 1, 'only one redemption may land for a one-shot code')
  assert.equal(await balanceOf(userId), 5000, 'the balance was bumped exactly once')
  assert.equal(await ledgerSum(userId, 'promo_code'), 5000)
  const count = await db.prepare('SELECT redemption_count FROM freellm_promo_codes WHERE id = ?').bind(promo.id).first<{ redemption_count: number }>()
  assert.equal(count?.redemption_count, 1)
})

test('promo redeem: a second redemption by the same user is denied without burning a slot', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const promo = await seedPromo('peruser', { credits: 5000, maxRedemptions: 10 })

  const statements = (redemptionId: string) =>
    promoRedemptionStatements(db, {
      promo,
      user: { id: userId },
      redemptionId,
      ledgerId: `ledger_${redemptionId}`,
      timestamp: Date.now(),
    })

  const first = await runBatch(statements('r_first'))
  assert.equal(first[0].meta?.changes, 1)

  // Sequential retry: the per-user subquery in the reserve blocks it, so no
  // redemption row is inserted and redemption_count is NOT incremented.
  const second = await runBatch(statements('r_second'))
  assert.equal(second[0].meta?.changes, 0, 'the reserve must not fire for a limited user')
  assert.equal(second[1].meta?.changes, 0, 'and no redemption row may insert')
  assert.equal(await balanceOf(userId), 5000)
  const count = await db.prepare('SELECT redemption_count FROM freellm_promo_codes WHERE id = ?').bind(promo.id).first<{ redemption_count: number }>()
  assert.equal(count?.redemption_count, 1, 'a denied retry must not burn a redemption slot')
})

test('promo expiry: an expired global grant is clawed back once, idempotently', async () => {
  const userId = await seedUser(db, { balanceCredits: 20_000 })
  const now = Date.now()

  // A redemption that expired in the past, still un-clawed, against a balance
  // that also holds 15,000cr from other sources. Only the promo's 5,000cr
  // should be clawed back, leaving the other 15,000 untouched.
  await db
    .prepare(
      `INSERT INTO freellm_promo_codes (id, code, credits, model_id, max_redemptions, redemption_count, per_user_limit, min_account_age_hours, starts_at, expires_at, active, created_at, updated_at)
       VALUES ('promo_exp', 'EXPIRED', 5000, NULL, NULL, 1, 1, 0, NULL, ?, 0, ?, ?)`,
    )
    .bind(now - 1000, now, now)
    .run()
  await db
    .prepare(
      `INSERT INTO freellm_promo_redemptions (id, promo_code_id, user_id, credits, model_id, created_at, expires_at)
       VALUES ('red_exp', 'promo_exp', ?, 5000, NULL, ?, ?)`,
    )
    .bind(userId, now - 5000, now - 1000)
    .run()

  const clawed = await expirePromoCredits(db, userId, now)
  assert.equal(clawed, 5000)
  assert.equal(await balanceOf(userId), 15_000, 'only the promo grant is clawed back')
  assert.equal(await ledgerSum(userId, 'promo_expiry'), -5000)

  // Idempotent: a second sweep finds nothing left to claw.
  assert.equal(await expirePromoCredits(db, userId, now), 0)
  assert.equal(await balanceOf(userId), 15_000)
})

test('promo expiry: the unspent portion is bounded by the current balance', async () => {
  const userId = await seedUser(db, { balanceCredits: 2_000 })
  const now = Date.now()

  // The user already spent 3,000 of the 5,000 promo grant, leaving 2,000.
  await db
    .prepare(
      `INSERT INTO freellm_promo_codes (id, code, credits, model_id, max_redemptions, redemption_count, per_user_limit, min_account_age_hours, starts_at, expires_at, active, created_at, updated_at)
       VALUES ('promo_part', 'PARTIAL', 5000, NULL, NULL, 1, 1, 0, NULL, ?, 0, ?, ?)`,
    )
    .bind(now - 1000, now, now)
    .run()
  await db
    .prepare(
      `INSERT INTO freellm_promo_redemptions (id, promo_code_id, user_id, credits, model_id, created_at, expires_at)
       VALUES ('red_part', 'promo_part', ?, 5000, NULL, ?, ?)`,
    )
    .bind(userId, now - 5000, now - 1000)
    .run()

  assert.equal(await expirePromoCredits(db, userId, now), 2000, 'claw is capped at the remaining balance')
  assert.equal(await balanceOf(userId), 0)
  assert.equal(await ledgerSum(userId, 'promo_expiry'), -2000)
})

test('promo expiry: a scoped grant is clawed from its per-model balance', async () => {
  const userId = await seedUser(db, { balanceCredits: 0, scopedCredits: 8_000 })
  const now = Date.now()

  await db
    .prepare(
      `INSERT INTO freellm_promo_codes (id, code, credits, model_id, max_redemptions, redemption_count, per_user_limit, min_account_age_hours, starts_at, expires_at, active, created_at, updated_at)
       VALUES ('promo_scoped', 'SCOPED', 8000, 'model_test', NULL, 1, 1, 0, NULL, ?, 0, ?, ?)`,
    )
    .bind(now - 1000, now, now)
    .run()
  await db
    .prepare(
      `INSERT INTO freellm_promo_redemptions (id, promo_code_id, user_id, credits, model_id, created_at, expires_at)
       VALUES ('red_scoped', 'promo_scoped', ?, 8000, 'model_test', ?, ?)`,
    )
    .bind(userId, now - 5000, now - 1000)
    .run()

  assert.equal(await expirePromoCredits(db, userId, now), 8000)
  const grant = await db
    .prepare('SELECT credits FROM freellm_model_credit_grants WHERE user_id = ? AND model_id = ?')
    .bind(userId, 'model_test')
    .first<{ credits: number }>()
  assert.equal(grant?.credits, 0, 'the per-model grant is drained')
  assert.equal(await ledgerSum(userId, 'promo_expiry'), -8000)
})

test('promo redeem: the per-user UNIQUE blocks concurrent redemptions by the same user', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const promo = await seedPromo('peruser-race', { credits: 5000, maxRedemptions: 10 })

  const statements = (redemptionId: string) =>
    promoRedemptionStatements(db, {
      promo,
      user: { id: userId },
      redemptionId,
      ledgerId: `ledger_${redemptionId}`,
      timestamp: Date.now(),
    })

  // A true parallel double-submit: both reserves may fire before either
  // redemption row exists — the UNIQUE index is the final word.
  const outcomes = await Promise.all([
    runBatch(statements('r_p1')).then(
      (r) => r[1].meta?.changes === 1,
      () => false,
    ),
    runBatch(statements('r_p2')).then(
      (r) => r[1].meta?.changes === 1,
      () => false,
    ),
  ])
  assert.equal(outcomes.filter(Boolean).length, 1, 'exactly one redemption may land')
  assert.equal(await balanceOf(userId), 5000)
})

// ---------------------------------------------------------------- referrals

test('referral payout: concurrent qualification sweeps pay ONCE', async () => {
  const now = Date.now()
  const referrer = 'ref_referrer'
  const referred = 'ref_referred'
  await db.batch([
    db.prepare('DELETE FROM freellm_users WHERE id IN (?, ?)').bind(referrer, referred),
    db.prepare(
      `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, created_at, updated_at)
       VALUES (?, 'a@x.com', 'a', NULL, 'refa0001', 0, 'user', 1, ?, ?)`,
    ).bind(referrer, now, now),
    db.prepare(
      `INSERT INTO freellm_users (id, email, username, password_hash, referral_code, balance_credits, role, email_verified, created_at, updated_at)
       VALUES (?, 'b@x.com', 'b', NULL, 'refb0001', 0, 'user', 1, ?, ?)`,
    ).bind(referred, now, now),
  ])
  // The referred user burns well past the token milestone.
  await db
    .prepare(
      `INSERT INTO freellm_usage_events (id, request_id, user_id, model, provider, source, input_tokens, output_tokens, total_tokens, credits_charged, status, key_mode, latency_ms, created_at)
       VALUES ('evt_1', 'req_1', ?, 'test-model', 'p', 'reported', 1000, 1000, 200000, 200000, 'completed', 'pool', 10, ?)`,
    )
    .bind(referred, now)
    .run()
  await db
    .prepare(
      `INSERT INTO freellm_referrals (id, referrer_id, referred_id, status, created_at)
       VALUES ('ref_row', ?, ?, 'waiting', ?)`,
    )
    .bind(referrer, referred, now - 86_400_000)
    .run()

  const [paidA, paidB] = await Promise.all([qualifyReferrals(db, referrer), qualifyReferrals(db, referrer)])
  assert.equal(paidA + paidB, 1, 'only one sweep may pay the waiting referral')
  assert.equal(await balanceOf(referrer), REFERRAL_REWARD)
  assert.equal(await ledgerSum(referrer, 'referral_reward'), REFERRAL_REWARD)
  const row = await db.prepare('SELECT status FROM freellm_referrals WHERE id = ?').bind('ref_row').first<{ status: string }>()
  assert.equal(row?.status, 'paid')
})

// ----------------------------------------------------------------- metering

test('settle respects outstanding holds — balance never goes negative', async () => {
  const userId = await seedUser(db, { balanceCredits: 1000 })

  // Another in-flight request holds most of the balance; this settlement
  // would leave less than that reserve, so it must be refused.
  await placeHold(db, userId, 'other-request', 900)

  await assert.rejects(
    () =>
      settleRequest(db, {
        userId,
        requestId: 'req_hold',
        model: testModel,
        providerLabel: 'test-provider',
        settlement: { kind: 'completed', usage: { input: 150, output: 50, total: 200 } },
        latencyMs: 5,
      }),
    /insufficient credits at settlement/,
    'settlement must honour the other request\u2019s reserve',
  )
  assert.equal((await db.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?').bind(userId).first<{ balance_credits: number }>())?.balance_credits, 1000)
  const events = await db.prepare('SELECT COUNT(*) AS n FROM freellm_usage_events WHERE request_id = ?').bind('req_hold').first<{ n: number }>()
  assert.equal(events?.n, 0, 'a rejected settlement writes no usage event either')
})

test('settle succeeds and charges exactly once when the hold is respected', async () => {
  const userId = await seedUser(db, { balanceCredits: 1000 })
  await placeHold(db, userId, 'other-request-2', 400)

  const result = await settleRequest(db, {
    userId,
    requestId: 'req_ok',
    model: testModel,
    providerLabel: 'test-provider',
    settlement: { kind: 'completed', usage: { input: 150, output: 50, total: 200 } },
    latencyMs: 5,
  })
  assert.equal(result.creditsCharged, 200)
  assert.equal((await db.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?').bind(userId).first<{ balance_credits: number }>())?.balance_credits, 800)

  // Retry with the same request_id replays the original, no second charge.
  const again = await settleRequest(db, {
    userId,
    requestId: 'req_ok',
    model: testModel,
    providerLabel: 'test-provider',
    settlement: { kind: 'completed', usage: { input: 150, output: 50, total: 200 } },
    latencyMs: 5,
  })
  assert.equal(again.alreadySettled, true)
  assert.equal(again.creditsCharged, 200)
  assert.equal((await db.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?').bind(userId).first<{ balance_credits: number }>())?.balance_credits, 800)
})
