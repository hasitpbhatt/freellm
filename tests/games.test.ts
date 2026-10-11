import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import {
  ARCADE_MAX_LEVEL,
  REACTION_GLOBAL_DAILY_BUDGET,
  REACTION_MIN_MS,
  REACTION_USER_DAILY_PLAYS,
  levelBonus,
  levelForXp,
  rewardForReaction,
  rewardForTaps,
  rewardForTyping,
} from '../functions/routes/games'
import { createTestDb, seedUser } from './helpers/db'

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

test('rewardForReaction: skill tiers with a human floor', () => {
  assert.equal(rewardForReaction(150), 50)
  assert.equal(rewardForReaction(250), 25)
  assert.equal(rewardForReaction(1000), 10)
  assert.equal(rewardForReaction(119), null)
  assert.equal(rewardForReaction(5001), null)
  assert.equal(rewardForReaction(Number.NaN), null)
  assert.ok(REACTION_MIN_MS === 120)
  assert.ok(REACTION_USER_DAILY_PLAYS === 5)
  assert.ok(REACTION_GLOBAL_DAILY_BUDGET === 250_000)
})

test('rewardForTyping: exact-match speed tiers with cheat windows', () => {
  // 60 chars in 30s = 24wpm → 25; in 10s = 72wpm → 50; in 5s = 144wpm → 100
  assert.equal(rewardForTyping(60, 30), 25)
  assert.equal(rewardForTyping(60, 10), 50)
  assert.equal(rewardForTyping(60, 5), 100)
  assert.equal(rewardForTyping(60, 1), null)
  assert.equal(rewardForTyping(60, 200), null)
  assert.equal(rewardForTyping(0, 10), null)
})

test('rewardForTaps: human count bands in the 5s window', () => {
  assert.equal(rewardForTaps(45), 50)
  assert.equal(rewardForTaps(30), 25)
  assert.equal(rewardForTaps(10), 10)
  assert.equal(rewardForTaps(4), null)
  assert.equal(rewardForTaps(61), null)
  assert.equal(rewardForTaps(25.5), null)
})
test('game rounds: one conditional claim per round, race-safe', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const now = Date.now()
  await db
    .prepare('INSERT INTO freellm_game_rounds (id, user_id, created_at, reward) VALUES (?, ?, ?, 0)')
    .bind('round_1', userId, now)
    .run()
  const first = (await db
    .prepare('UPDATE freellm_game_rounds SET claimed_at = ?, reaction_ms = ?, reward = ? WHERE id = ? AND claimed_at IS NULL')
    .bind(now, 150, 50, 'round_1')
    .run() as unknown as { meta?: { changes?: number } })
  assert.equal(first?.meta?.changes, 1)
  const second = (await db
    .prepare('UPDATE freellm_game_rounds SET claimed_at = ?, reaction_ms = ?, reward = ? WHERE id = ? AND claimed_at IS NULL')
    .bind(now, 150, 50, 'round_1')
    .run() as unknown as { meta?: { changes?: number } })
  assert.equal(second?.meta?.changes, 0)
})

test('levels: thresholds rise, bonuses stay bounded, max level caps', () => {
  assert.equal(levelForXp(0), 1)
  assert.equal(levelForXp(99), 1)
  assert.equal(levelForXp(100), 2)
  assert.equal(levelForXp(299), 2)
  assert.equal(levelForXp(300), 3)
  assert.equal(levelForXp(1500), 6)
  assert.equal(levelForXp(99999), 6)
  assert.equal(levelBonus(2), 100)
  assert.equal(levelBonus(6), 300)
  assert.equal(ARCADE_MAX_LEVEL, 6)
})
