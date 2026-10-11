import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import {
  ARCADE_MAX_LEVEL,
  ARCADE_GLOBAL_DAILY_BUDGET,
  MEMORY_PAIRS,
  MEMORY_MIN_SECONDS,
  MEMORY_MAX_SECONDS,
  MEMORY_MAX_MOVES,
  TYPING_MIN_SECONDS,
  TYPING_MAX_SECONDS,
  CHESS_MAX_ATTEMPTS,
  CHESS_MIN_SECONDS,
  CHESS_MAX_SECONDS,
  levelBonus,
  levelForXp,
  rewardForTyping,
  rewardForMemory,
  rewardForChess,
  dealMemoryBoard,
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

test('rewardForTyping: exact-match speed tiers with cheat windows', () => {
  // 60 chars in 30s = 24wpm → 250; in 10s = 72wpm → 500; in 5s = 144wpm → 1000
  assert.equal(rewardForTyping(60, 30), 250)
  assert.equal(rewardForTyping(60, 10), 500)
  assert.equal(rewardForTyping(60, 5), 1000)
  assert.equal(rewardForTyping(60, 1), null)
  assert.equal(rewardForTyping(60, 200), null)
  assert.equal(rewardForTyping(0, 10), null)
})

test('rewardForMemory: human move bands in the 10min window', () => {
  // 6 pairs: perfect=6, good=9, slow=30
  assert.equal(rewardForMemory(6), 12000)
  assert.equal(rewardForMemory(9), 8000)
  assert.equal(rewardForMemory(30), 4000)
  // outside human bounds
  assert.equal(rewardForMemory(5), null)
  assert.equal(rewardForMemory(31), null)
  assert.equal(rewardForMemory(6.5), null)
})

test('rewardForChess: attempt bands with anti-guessing', () => {
  // 4 options per puzzle; 1 attempt = solved immediately, 2 = lucky guess, 3-5 = brute force
  assert.equal(rewardForChess(1), 8000)
  assert.equal(rewardForChess(2), 5000)
  assert.equal(rewardForChess(5), 2500)
  assert.equal(rewardForChess(0), null)
  assert.equal(rewardForChess(6), null)
  assert.equal(rewardForChess(1.5), null)
})

test('dealMemoryBoard: 12 cards, two of each glyph, properly shuffled', () => {
  const { board } = dealMemoryBoard()
  assert.ok(Array.isArray(board))
  assert.equal(board.length, 12)
  // each glyph appears exactly twice
  for (const glyph of ['♞', '♜', '♝', '♛', '♚', '♟']) {
    const count = board.filter((g) => g === glyph).length
    assert.equal(count, 2)
  }
  // two consecutive deals should almost never be identical (2.3e-9 chance)
  const { board: board2 } = dealMemoryBoard()
  assert.ok(board.some((g, i) => g !== board2[i]))
})

test('game rounds: one conditional claim per round, race-safe', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const now = Date.now()
  await db
    .prepare('INSERT INTO freellm_game_rounds (id, user_id, created_at, reward) VALUES (?, ?, ?, 0)')
    .bind('round_1', userId, now)
    .run()
  const first = (await db
    .prepare('UPDATE freellm_game_rounds SET claimed_at = ?, reward = ? WHERE id = ? AND claimed_at IS NULL')
    .bind(now, 50, 'round_1')
    .run() as unknown as { meta?: { changes?: number } })
  assert.equal(first?.meta?.changes, 1)
  const second = (await db
    .prepare('UPDATE freellm_game_rounds SET claimed_at = ?, reward = ? WHERE id = ? AND claimed_at IS NULL')
    .bind(now, 50, 'round_1')
    .run() as unknown as { meta?: { changes?: number } })
  assert.equal(second?.meta?.changes, 0)
})

test('levels: thresholds rise, bonuses stay bounded, max level caps', () => {
  assert.equal(levelForXp(0), 1)
  assert.equal(levelForXp(5999), 1)
  assert.equal(levelForXp(6000), 2)
  assert.equal(levelForXp(17999), 2)
  assert.equal(levelForXp(18000), 3)
  assert.equal(levelForXp(90000), 6)
  assert.equal(levelForXp(9999999), 6)
  assert.equal(levelBonus(2), 6000)
  assert.equal(levelBonus(6), 18000)
  assert.equal(ARCADE_MAX_LEVEL, 6)
})

test('constants: daily pot and game bounds are sane', () => {
  assert.ok(ARCADE_GLOBAL_DAILY_BUDGET === 500_000)
  assert.ok(MEMORY_PAIRS === 6)
  assert.ok(MEMORY_MIN_SECONDS === 15)
  assert.ok(MEMORY_MAX_SECONDS === 600)
  assert.ok(MEMORY_MAX_MOVES === 30)
  assert.ok(TYPING_MIN_SECONDS === 2)
  assert.ok(TYPING_MAX_SECONDS === 120)
  assert.ok(CHESS_MAX_ATTEMPTS === 5)
  assert.ok(CHESS_MIN_SECONDS === 10)
  assert.ok(CHESS_MAX_SECONDS === 600)
})