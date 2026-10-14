// Arcade: skill games paying bounded Pool credits — typing proficiency and a
// memory-match board. The 10-second reflex games were cut: they read as
// childish and paid like real work. Chess tactics were also descoped.
//
// Norman design notes (why they look this way):
// - Few controls, labeled states each, fouls forgiven with zero penalty.
// - Tiers, plays-left, and caps shown BEFORE playing (feedforward); results
//   name exact credits (feedback).
//
// Tokenomics (bounded on both axes, effort-proportional):
// - Server issues every round and validates the result; rewards are computed
//   server-side, never trusted from the client.
// - Per game per user per day: typing 3, memory 2. Global daily pot
//   1,000,000cr shared by all games. Solved-all bonus 7,000cr for finishing
//   both (once/day). A full clear pays ~61,000cr max (typing 3x10k + memory
//   2x12k + 7k clear) — roughly one day of check-ins for real skilled play.
//   Typing pays per-play less than memory (seconds of work vs minutes), but
//   every tier beats the 2,000cr flat-rate chat so a win always buys messages.

import { Hono } from 'hono'
import { requireAuth } from '../lib/middleware'
import { newId } from '../lib/crypto'
import type { Bindings, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const now = () => Date.now()

// ------------------------------------------------------------------ tuning

/** Shared daily mint cap across all arcade games. */
export const ARCADE_GLOBAL_DAILY_BUDGET = 1_000_000

export type GameKind = 'typing' | 'memory'

const GAME_DAILY_CAPS: Record<GameKind, number> = { typing: 3, memory: 2 }

/** WPM tiers for typing: [minimum wpm, reward]. Top tier = 5 flat-rate chats. */
export const TYPING_TIERS: { minWpm: number; reward: number }[] = [
  { minWpm: 80, reward: 10000 },
  { minWpm: 50, reward: 5000 },
  { minWpm: 0, reward: 2500 },
]
export const TYPING_MIN_SECONDS = 2
export const TYPING_MAX_SECONDS = 120

// Memory match: 6 pairs, server-dealt and never revealed up front. Reward
// keys off pair-attempts (perfect = 6); the clock only rejects bots (<15s)
// and stale boards (>10min).
export const MEMORY_PAIRS = 6
export const MEMORY_CARDS = MEMORY_PAIRS * 2
export const MEMORY_ROUND_TTL_MS = 600_000
export const MEMORY_MIN_SECONDS = 15
export const MEMORY_MAX_SECONDS = 600
export const MEMORY_MAX_MOVES = 30
export const MEMORY_TIERS: { maxMoves: number; reward: number }[] = [
  { maxMoves: 8, reward: 12000 },
  { maxMoves: 12, reward: 8000 },
  { maxMoves: MEMORY_MAX_MOVES, reward: 4000 },
]
// Card faces for memory game (6 pairs)
export const MEMORY_GLYPHS = ['♞', '♜', '♝', '♛', '♚', '♟']

export const CLEAR_BONUS_REWARD = 7000
const CLEAR_GAMES: GameKind[] = ['typing', 'memory']

// ------------------------------------------------------------------ levels
// XP is lifetime arcade credits / 10 — derived, never stored, cannot drift.
// Level-ups pay a one-time bonus (3000 x level); lifetime max 60,000cr/user.

export const XP_PER_CREDIT = 0.1
export const ARCADE_LEVELS: { level: number; xp: number }[] = [
  { level: 2, xp: 6000 },
  { level: 3, xp: 18000 },
  { level: 4, xp: 36000 },
  { level: 5, xp: 60000 },
  { level: 6, xp: 90000 },
]
export const ARCADE_MAX_LEVEL = 6

export function levelForXp(xp: number): number {
  let level = 1
  for (const row of ARCADE_LEVELS) {
    if (xp >= row.xp) level = row.level
  }
  return level
}

export function levelBonus(level: number): number {
  return 3000 * level
}

async function arcadeXp(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COALESCE(SUM(delta), 0) AS total FROM freellm_credit_ledger WHERE user_id = ? AND reason = 'game_reward'`)
    .bind(userId)
    .first<{ total: number }>()
  return Math.floor((row?.total ?? 0) * XP_PER_CREDIT)
}

async function claimedLevels(db: D1Database, userId: string): Promise<Set<number>> {
  const rows = await db
    .prepare('SELECT level FROM freellm_arcade_levels WHERE user_id = ?')
    .bind(userId)
    .all<{ level: number }>()
  return new Set(rows.results.map((r) => r.level))
}

const TYPING_PHRASES = [
  'The quick brown fox jumps over the lazy dog near the river bank.',
  'Pack my box with five dozen liquor jugs before the night ends.',
  'Bright vixens jump; dozy fowl quack loudly over the old mill pond.',
  'Six big devils from Japan quickly forgot how to waltz together.',
  'The five boxing wizards jump quickly over every hurdle set.',
  'Jaded zombies acted quaintly but kept driving their oxen forward.',
  'Clever makers fix funky quartz problems with jumps and swift حلول.',
  'A very bad quack might jinx zippy fowls before dawn breaks.',
]

// Memory board shape: which glyph sits on which card index. The board is
// dealt server-side, shuffled, and stored in the round's detail column; the
// client only ever sees revealed cards, so a peeking client learns nothing.
export function dealMemoryBoard(): { board: string[] } {
  const faces = [...MEMORY_GLYPHS, ...MEMORY_GLYPHS] // two of each
  for (let i = faces.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[faces[i], faces[j]] = [faces[j], faces[i]]
  }
  return { board: faces }
}

/** Server-side reward from a validated final board state. */
export function rewardForMemory(moves: number): number | null {
  if (!Number.isInteger(moves) || moves < MEMORY_PAIRS || moves > MEMORY_MAX_MOVES) return null
  for (const tier of MEMORY_TIERS) {
    if (moves <= tier.maxMoves) return tier.reward
  }
  return null
}

/** Server-side reward from the stored flip counter. */
export function rewardForMemoryFlips(flips: number): number | null {
  const moves = memoryMovesFromFlips(flips)
  return moves === null ? null : rewardForMemory(moves)
}

/**
 * Pair-attempts from the server's stored flip counter. A completed memory
 * board flips every card an even number of times (a pair attempt is two
 * flips by construction), so moves = flips / 2 exactly. The client never
 * reports its score — the claim derives the tier from this counter, so the
 * only way to understate moves is to not flip, which pays nothing.
 */
export function memoryMovesFromFlips(flips: number): number | null {
  if (!Number.isInteger(flips) || flips < MEMORY_PAIRS * 2 || flips % 2 !== 0) return null
  return flips / 2
}

/** Server-side typing reward from validated exact-match typing. */
export function rewardForTyping(chars: number, seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < TYPING_MIN_SECONDS || seconds > TYPING_MAX_SECONDS) return null
  if (chars <= 0) return null
  const wpm = chars / 5 / (seconds / 60)
  for (const tier of TYPING_TIERS) {
    if (wpm >= tier.minWpm) return tier.reward
  }
  return null
}

/** Returns the current UTC day as YYYY-MM-DD. */
function utcDay(): string {
  return new Date(now()).toISOString().slice(0, 10)
}

function dayStartMs(): number {
  return Date.parse(`${utcDay()}T00:00:00Z`)
}

function verifiedGate(user: { email_verified: number }) {
  if (user.email_verified !== 1) {
    return {
      error: 'verification_required',
      message: 'Verify your email on the Earn page before playing for credits.',
    } as const
  }
  return null
}

function parseGame(value: unknown): GameKind | null {
  return value === 'typing' || value === 'memory' ? value : null
}

async function paidPlaysToday(db: D1Database, userId: string, game: GameKind): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM freellm_game_rounds
       WHERE user_id = ? AND game = ? AND claimed_at IS NOT NULL AND claimed_at >= ?`,
    )
    .bind(userId, game, dayStartMs())
    .first<{ n: number }>()
  return row?.n ?? 0
}

async function globalSpentToday(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(l.delta), 0) AS spent FROM freellm_credit_ledger l
       WHERE l.reason = 'game_reward' AND l.created_at >= ?`,
    )
    .bind(dayStartMs())
    .first<{ spent: number }>()
  return row?.spent ?? 0
}

async function claimBlockReason(
  db: D1Database,
  userId: string,
  kind: 'play' | 'clear',
  game: GameKind,
): Promise<{ error: string; message: string }> {
  const clearToday = await db
    .prepare("SELECT 1 AS x FROM freellm_game_rounds WHERE user_id = ? AND game = 'clear' AND claimed_at >= ?")
    .bind(userId, dayStartMs())
    .first()
  if (kind === 'clear') {
    if (clearToday) {
      return { error: 'already_claimed', message: 'Clear bonus already claimed today.' }
    }
    return { error: 'not_cleared', message: 'Finish both games today to claim the clear bonus.' }
  }
  const used = await paidPlaysToday(db, userId, game)
  if (used >= GAME_DAILY_CAPS[game]) {
    return { error: 'daily_cap', message: 'Daily play budget spent — come back tomorrow.' }
  }
  const spent = await globalSpentToday(db)
  if (spent >= ARCADE_GLOBAL_DAILY_BUDGET) {
    return { error: 'pot_empty', message: "Today's arcade pot is empty — come back tomorrow." }
  }
  return { error: 'already_claimed', message: 'Round already claimed.' }
}

/**
 * Ledger + balance statements for a game payout. Each one is conditioned on
 * the claim marker (the round row this same batch just claimed), so the
 * guard and the grant commit together or not at all — a crash between the
 * claim and the payout can no longer strand a claimed round unpaid.
 *
 * The ledger row's id is DETERMINISTIC per payout target (one per round for
 * plays, one per user per day for the clear bonus). That is the final
 * backstop: if two concurrent batches both pass the claim guard in the same
 * millisecond (the same-timestamp marker flaw), the second ledger insert
 * violates the PRIMARY KEY, which rolls the whole losing batch back — so
 * exactly one payout can ever land.
 */
export function gameGrantStatements(
  db: D1Database,
  params: { userId: string; game: string; roundId: string; ledgerId: string; reward: number; detail: string; timestamp: number },
) {
  const { userId, game, roundId, ledgerId, reward, detail, timestamp } = params
  return [
    db
      .prepare(
        `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
         SELECT ?, ?, ?, 'game_reward', ?, ?
         WHERE EXISTS (SELECT 1 FROM freellm_game_rounds
                       WHERE id = ? AND claimed_at = ? AND reward = ?)`,
      )
      .bind(ledgerId, userId, reward, JSON.stringify({ game, round_id: roundId, detail }), timestamp, roundId, timestamp, reward),
    db
      .prepare(
        `UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ?
         WHERE id = ? AND EXISTS (SELECT 1 FROM freellm_game_rounds
                                  WHERE id = ? AND claimed_at = ? AND reward = ?)`,
      )
      .bind(reward, timestamp, userId, roundId, timestamp, reward),
  ]
}

/**
 * The claim + payout batch for a paid play. The claim statement carries the
 * daily cap and the global daily pot as subqueries inside its own WHERE, so
 * two claims racing on two DIFFERENT rounds of the same game cannot both
 * pass the cap (D1 serializes the write transactions; the second statement
 * sees the first one's committed claim). Result: exactly one payout, ever.
 */
export function gameClaimStatements(
  db: D1Database,
  params: { userId: string; game: GameKind; roundId: string; reward: number; detail: string; timestamp: number },
) {
  const { userId, game, roundId, reward, detail, timestamp } = params
  return [
    db
      .prepare(
        `UPDATE freellm_game_rounds SET claimed_at = ?, reward = ?
         WHERE id = ? AND claimed_at IS NULL
           AND (SELECT COUNT(*) FROM freellm_game_rounds
                 WHERE user_id = ? AND game = ? AND claimed_at IS NOT NULL AND claimed_at >= ?) < ?
           AND (SELECT COALESCE(SUM(delta), 0) FROM freellm_credit_ledger
                 WHERE reason = 'game_reward' AND created_at >= ?) <= ?`,
      )
      .bind(
        timestamp,
        reward,
        roundId,
        userId,
        game,
        dayStartMs(),
        GAME_DAILY_CAPS[game],
        dayStartMs(),
        ARCADE_GLOBAL_DAILY_BUDGET - reward,
      ),
    ...gameGrantStatements(db, {
      userId,
      game,
      roundId,
      ledgerId: `game_reward:play:${roundId}`,
      reward,
      detail,
      timestamp,
    }),
  ]
}

/**
 * The clear-bonus claim + payout batch. The INSERT ... SELECT form is the
 * guard: the row only lands when today's paid plays in every arcade game
 * exist and no clear bonus was claimed yet today, so two concurrent claims
 * insert one row and pay once. The ledger id is per user per day, so even a
 * same-millisecond collision rolls the loser back.
 */
export function clearClaimStatements(
  db: D1Database,
  params: { userId: string; roundId: string; timestamp: number },
) {
  const { userId, roundId, timestamp } = params
  return [
    db
      .prepare(
        `INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, claimed_at, reward)
         SELECT ?, ?, 'clear', 'daily-clear', ?, ?, ?
         WHERE NOT EXISTS (SELECT 1 FROM freellm_game_rounds
                            WHERE user_id = ? AND game = 'clear' AND claimed_at >= ?)
           AND (SELECT COUNT(*) FROM freellm_game_rounds
                 WHERE user_id = ? AND game = 'typing' AND claimed_at IS NOT NULL AND claimed_at >= ?) > 0
           AND (SELECT COUNT(*) FROM freellm_game_rounds
                 WHERE user_id = ? AND game = 'memory' AND claimed_at IS NOT NULL AND claimed_at >= ?) > 0`,
      )
      .bind(
        roundId,
        userId,
        timestamp,
        timestamp,
        CLEAR_BONUS_REWARD,
        userId,
        dayStartMs(),
        userId,
        dayStartMs(),
        userId,
        dayStartMs(),
      ),
    ...gameGrantStatements(db, {
      userId,
      game: 'clear',
      roundId,
      ledgerId: `game_reward:clear:${userId}:${utcDay()}`,
      reward: CLEAR_BONUS_REWARD,
      detail: 'daily-clear',
      timestamp,
    }),
  ]
}

// ------------------------------------------------------------------ status

app.get('/api/games/status', requireAuth, async (c) => {
  const user = c.get('user')
  const games = {} as Record<GameKind, { plays_left: number; plays_cap: number }>
  for (const game of CLEAR_GAMES) {
    const used = await paidPlaysToday(c.env.DB, user.id, game)
    games[game] = { plays_left: Math.max(0, GAME_DAILY_CAPS[game] - used), plays_cap: GAME_DAILY_CAPS[game] }
  }
  const earned = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(reward), 0) AS earned FROM freellm_game_rounds
     WHERE user_id = ? AND claimed_at IS NOT NULL AND claimed_at >= ? AND game != 'clear'`,
  )
    .bind(user.id, dayStartMs())
    .first<{ earned: number }>()
  const cleared = await c.env.DB.prepare(
    `SELECT 1 AS x FROM freellm_game_rounds WHERE user_id = ? AND game = 'clear' AND claimed_at >= ?`,
  )
    .bind(user.id, dayStartMs())
    .first()
  const allPlayed = CLEAR_GAMES.every((g) => games[g].plays_left < GAME_DAILY_CAPS[g])

  const xp = await arcadeXp(c.env.DB, user.id)
  const level = levelForXp(xp)
  const nextRow = ARCADE_LEVELS.find((r) => r.level === level + 1) ?? null
  const claimed = await claimedLevels(c.env.DB, user.id)
  const pendingLevel = ARCADE_LEVELS.map((r) => r.level)
    .filter((lv) => lv <= level && !claimed.has(lv))
    .sort((a, b) => a - b)[0] ?? null
  return c.json({
    games,
    earned_today: earned?.earned ?? 0,
    level: {
      level,
      xp,
      max_level: ARCADE_MAX_LEVEL,
      next_xp: nextRow ? nextRow.xp : null,
      pending: pendingLevel !== null ? { level: pendingLevel, reward: levelBonus(pendingLevel) } : null,
    },
    clear: {
      done: !!cleared,
      ready: !cleared && allPlayed,
      reward: CLEAR_BONUS_REWARD,
      needs: CLEAR_GAMES.filter((g) => games[g].plays_left >= GAME_DAILY_CAPS[g]),
    },
    typing_tiers: TYPING_TIERS.map((t) => ({ min_wpm: t.minWpm, reward: t.reward })),
    memory_tiers: MEMORY_TIERS.map((t) => ({ max_moves: t.maxMoves, reward: t.reward })),
  })
})

// ------------------------------------------------------------------- start

app.post('/api/games/:game/start', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = verifiedGate(user)
  if (gate) return c.json(gate, 403)

  const game = parseGame(c.req.param('game'))
  if (!game) return c.json({ error: 'not_found', message: 'Unknown game.' }, 404)

  const id = newId()
  const timestamp = now()

  if (game === 'typing') {
    // The phrase must come from the server so pasting foreign text cannot score.
    const phrase = TYPING_PHRASES[Math.floor(Math.random() * TYPING_PHRASES.length)]
    await c.env.DB.prepare('INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, reward) VALUES (?, ?, ?, ?, ?, 0)')
      .bind(id, user.id, game, phrase, timestamp)
      .run()
    return c.json({ round_id: id, phrase }, 201)
  }

  if (game === 'memory') {
    // The board layout is stored server-side and never sent to the client —
    // only per-card reveals are returned during play.
    const detail = JSON.stringify(dealMemoryBoard())
    await c.env.DB.prepare('INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, reward) VALUES (?, ?, ?, ?, ?, 0)')
      .bind(id, user.id, game, detail, timestamp)
      .run()
    return c.json({ round_id: id, pairs: MEMORY_PAIRS }, 201)
  }

  // parseGame() only admits the two live games; this is unreachable.
  return c.json({ error: 'not_found', message: 'Unknown game.' }, 404)
})

// -------------------------------------------------------------------- flip

app.post('/api/games/memory/flip', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = verifiedGate(user)
  if (gate) return c.json(gate, 403)

  const body = await c.req.json<{ round_id?: unknown; index?: unknown }>().catch(() => null)
  const roundId = typeof body?.round_id === 'string' ? body.round_id : ''
  const index = typeof body?.index === 'number' ? Math.floor(body.index) : NaN
  if (!roundId) return c.json({ error: 'invalid_input', message: 'round_id is required.' }, 400)

  const timestamp = now()
  const round = await c.env.DB.prepare('SELECT user_id, game, detail, created_at FROM freellm_game_rounds WHERE id = ?')
    .bind(roundId)
    .first<{ user_id: string; game: string; detail: string | null; created_at: number }>()
  if (!round || round.user_id !== user.id || round.game !== 'memory') {
    return c.json({ error: 'not_found', message: 'Round not found.' }, 404)
  }
  if (timestamp - round.created_at > MEMORY_ROUND_TTL_MS) {
    return c.json({ error: 'expired', message: 'Round expired — start a fresh one.' }, 410)
  }
  if (!Number.isInteger(index) || index < 0 || index >= MEMORY_CARDS) {
    return c.json({ error: 'invalid_input', message: 'Card index out of range.' }, 422)
  }

  let board: string[]
  try {
    board = (JSON.parse(round.detail ?? '{}') as { board?: unknown }).board as string[]
    if (!Array.isArray(board) || board.length !== MEMORY_CARDS) throw new Error('bad board')
  } catch {
    return c.json({ error: 'invalid_round', message: 'Round is corrupt — start a fresh one.' }, 500)
  }

  // Reveal only the requested card; the rest of the board stays server-side.
  // Each flip advances the server's authoritative flip counter, so the claim
  // derives the score from flips/2 — the client's own count is ignored and
  // cannot understate the pair-attempts.
  await c.env.DB.prepare('UPDATE freellm_game_rounds SET flips = flips + 1 WHERE id = ?')
    .bind(roundId)
    .run()
  return c.json({ ok: true, index, glyph: board[index] })
})

// ------------------------------------------------------------------- claim

app.post('/api/games/:game/claim', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = verifiedGate(user)
  if (gate) return c.json(gate, 403)

  const game = parseGame(c.req.param('game'))
  if (!game) return c.json({ error: 'not_found', message: 'Unknown game.' }, 404)

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  const roundId = typeof body?.round_id === 'string' ? body.round_id : ''
  if (!roundId) return c.json({ error: 'invalid_input', message: 'round_id is required.' }, 400)

  const timestamp = now()
  const round = await c.env.DB.prepare('SELECT user_id, game, detail, created_at, flips, attempts FROM freellm_game_rounds WHERE id = ?')
    .bind(roundId)
    .first<{ user_id: string; game: string; detail: string | null; created_at: number; flips: number; attempts: number }>()
  if (!round || round.user_id !== user.id || round.game !== game) {
    return c.json({ error: 'not_found', message: 'Round not found.' }, 404)
  }
  const ageMs = timestamp - round.created_at
  const seconds = ageMs / 1000

  // Per-game server-side scoring. Every score input is either compared to
  // a server-held value (typing) or read from a counter the server
  // maintains (memory flips) — the client's own counts are ignored, so the
  // tier cannot be understated.
  let reward: number | null = null
  let detail = ''
  if (game === 'typing') {
    const typed = typeof body?.typed === 'string' ? body.typed : null
    if (typed === null || !round.detail || typed !== round.detail) {
      return c.json({ error: 'mismatch', message: 'Typed text must match the given phrase exactly — no pay, try again.' }, 422)
    }
    reward = rewardForTyping(round.detail.length, seconds)
    detail = `wpm:${(round.detail.length / 5 / (seconds / 60)).toFixed(1)}`
    if (reward === null) {
      return c.json({ error: 'invalid_time', message: 'Too fast to be typing or too slow to count — no pay, try again.' }, 422)
    }
  } else {
    // Memory: pair-attempts come from the server's flip counter — the
    // client's own count is ignored entirely.
    const moves = memoryMovesFromFlips(round.flips ?? 0)
    if (seconds < MEMORY_MIN_SECONDS) {
      return c.json({ error: 'invalid_time', message: 'That board was solved too fast to be human — no pay, try again.' }, 422)
    }
    if (seconds > MEMORY_MAX_SECONDS) {
      return c.json({ error: 'expired', message: 'Round expired — start a fresh one.' }, 410)
    }
    if (moves === null) {
      return c.json(
        { error: 'invalid_moves', message: `Move counts must be ${MEMORY_PAIRS}–${MEMORY_MAX_MOVES} — no pay, try again.` },
        422,
      )
    }
    reward = rewardForMemory(moves)
    detail = `moves:${moves} flips:${round.flips ?? 0}`
    if (reward === null) {
      return c.json(
        { error: 'invalid_moves', message: `Move counts must be ${MEMORY_PAIRS}–${MEMORY_MAX_MOVES} — no pay, try again.` },
        422,
      )
    }
  }

  // Claim + payout in ONE batch (one transaction). The claim statement is
  // the race gate — round unclaimed, daily cap, and global pot are all
  // compared inside SQL — and the grant statements are conditioned on it,
  // so a capped-out, already-claimed, or out-raced claim pays nothing, and
  // a paid round is always claimed. No check-then-act window remains. The
  // batch can still lose a same-millisecond collision to the ledger's
  // deterministic id (PRIMARY KEY) — that rolls the whole batch back, so
  // the loser reports the standard already-claimed 409.
  let batchResult: Array<{ success: boolean; meta?: { changes?: number } }>
  try {
    batchResult = (await c.env.DB.batch(
      gameClaimStatements(c.env.DB, { userId: user.id, game, roundId, reward, detail, timestamp }),
    )) as unknown as Array<{ success: boolean; meta?: { changes?: number } }>
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_credit_ledger')) {
      return c.json({ error: 'already_claimed', message: 'Round already claimed.' }, 409)
    }
    throw err
  }
  const guard = batchResult[0]
  if (!guard?.success || guard.meta?.changes === 0) {
    const reason = await claimBlockReason(c.env.DB, user.id, 'play', game)
    return c.json({ error: reason.error, message: reason.message }, 409)
  }

  const balance = await c.env.DB.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?')
    .bind(user.id)
    .first<{ balance_credits: number }>()
  return c.json({ ok: true, reward, balance: balance?.balance_credits ?? 0 })
})

// ------------------------------------------------------------ clear bonus

app.post('/api/games/clear/claim', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = verifiedGate(user)
  if (gate) return c.json(gate, 403)

  // The insert itself is the guard: the row only lands when today's paid
  // plays in every arcade game exist and no clear bonus was claimed yet
  // today, so two concurrent claims insert one row and pay once — the old
  // check-then-insert let both through.
  const timestamp = now()
  const roundId = newId()
  let batchResult: Array<{ success: boolean; meta?: { changes?: number } }>
  try {
    batchResult = (await c.env.DB.batch(
      clearClaimStatements(c.env.DB, { userId: user.id, roundId, timestamp }),
    )) as unknown as Array<{ success: boolean; meta?: { changes?: number } }>
  } catch (err) {
    // Same-millisecond collision with another claim — the deterministic
    // ledger id rolled this batch back; the bonus is already paid.
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_credit_ledger')) {
      return c.json({ error: 'already_claimed', message: 'Clear bonus already claimed today.' }, 409)
    }
    throw err
  }
  if (!batchResult[0]?.success || batchResult[0].meta?.changes === 0) {
    const reason = await claimBlockReason(c.env.DB, user.id, 'clear', 'typing')
    return c.json({ error: reason.error, message: reason.message }, 409)
  }
  const balance = await c.env.DB.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?')
    .bind(user.id)
    .first<{ balance_credits: number }>()
  return c.json({ ok: true, reward: CLEAR_BONUS_REWARD, balance: balance?.balance_credits ?? 0 })
})

// ------------------------------------------------------------ level bonus

app.post('/api/games/level/claim', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = verifiedGate(user)
  if (gate) return c.json(gate, 403)

  const body = await c.req.json<{ level?: unknown }>().catch(() => null)
  const level = typeof body?.level === 'number' ? body.level : NaN
  if (!Number.isInteger(level) || level < 2 || level > ARCADE_MAX_LEVEL) {
    return c.json({ error: 'invalid_input', message: 'level must be an integer 2–6.' }, 400)
  }

  const xp = await arcadeXp(c.env.DB, user.id)
  if (levelForXp(xp) < level) {
    return c.json({ error: 'not_earned', message: 'Play more arcade games to reach that level.' }, 409)
  }

  const timestamp = now()
  const reward = levelBonus(level)
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO freellm_arcade_levels (user_id, level, created_at) VALUES (?, ?, ?)').bind(
        user.id,
        level,
        timestamp,
      ),
      c.env.DB.prepare(
        `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
         VALUES (?, ?, ?, 'game_reward', ?, ?)`,
      ).bind(newId(), user.id, reward, JSON.stringify({ arcade_level: level }), timestamp),
      c.env.DB.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?').bind(
        reward,
        timestamp,
        user.id,
      ),
    ])
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_arcade_levels')) {
      return c.json({ error: 'already_claimed', message: 'Level bonus already claimed.' }, 409)
    }
    throw err
  }
  const balance = await c.env.DB.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?')
    .bind(user.id)
    .first<{ balance_credits: number }>()
  return c.json({ ok: true, level, reward, balance: balance?.balance_credits ?? 0 })
})

export default app
