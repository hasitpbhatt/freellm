import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import {
  REACTION_GLOBAL_DAILY_BUDGET,
  REACTION_MIN_MS,
  REACTION_USER_DAILY_PLAYS,
  rewardForReaction,
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
