// Arcade: 10-second skill games paying bounded Pool credits.
//
// Norman design notes (why they look this way):
// - One control, three labeled states each, fouls forgiven with zero penalty.
// - Tiers, plays-left, and caps shown BEFORE playing (feedforward); results
//   name exact credits (feedback).
//
// Tokenomics (bounded on both axes):
// - Server issues every round and validates the result; rewards are computed
//   server-side, never trusted from the client.
// - Per game per user per day: reaction 5, typing 3, taps 3. Global daily pot
//   250,000cr shared by all games. Daily-clear bonus 150cr for finishing all
//   three (once/day). Worst case the arcade mints dust.

import { Hono } from 'hono'
import { requireAuth } from '../lib/middleware'
import { newId } from '../lib/crypto'
import type { Bindings, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const now = () => Date.now()

// ------------------------------------------------------------------ tuning

/** Fastest wins more: [upper bound ms, reward credits]. */
export const REACTION_TIERS: { maxMs: number; reward: number }[] = [
  { maxMs: 180, reward: 50 },
  { maxMs: 300, reward: 25 },
  { maxMs: 5000, reward: 10 },
]
export const REACTION_MIN_MS = 120
export const REACTION_ROUND_TTL_MS = 60_000
export const REACTION_USER_DAILY_PLAYS = 5
export const REACTION_GLOBAL_DAILY_BUDGET = 250_000

export type GameKind = 'reaction' | 'typing' | 'taps'

const GAME_DAILY_CAPS: Record<GameKind, number> = { reaction: 5, typing: 3, taps: 3 }

/** WPM tiers for typing: [minimum wpm, reward]. */
export const TYPING_TIERS: { minWpm: number; reward: number }[] = [
  { minWpm: 80, reward: 100 },
  { minWpm: 50, reward: 50 },
  { minWpm: 0, reward: 25 },
]
export const TYPING_MIN_SECONDS = 2
export const TYPING_MAX_SECONDS = 120

/** Tap-count tiers for the 5s frenzy: [minimum taps, reward]. */
export const TAPS_TIERS: { minTaps: number; reward: number }[] = [
  { minTaps: 40, reward: 50 },
  { minTaps: 25, reward: 25 },
  { minTaps: 5, reward: 10 },
]
export const TAPS_MIN_TAPS = 5
export const TAPS_MAX_TAPS = 60
export const TAPS_WINDOW_MS = 5000
export const TAPS_SLACK_MS = 4000

export const CLEAR_BONUS_REWARD = 150
const CLEAR_GAMES: GameKind[] = ['reaction', 'typing', 'taps']

// ------------------------------------------------------------------ levels
// XP is lifetime arcade credits / 10 — derived, never stored, cannot drift.
// Level-ups pay a one-time bonus (50 x level); lifetime max 1000cr/user.

export const XP_PER_CREDIT = 0.1
export const ARCADE_LEVELS: { level: number; xp: number }[] = [
  { level: 2, xp: 100 },
  { level: 3, xp: 300 },
  { level: 4, xp: 600 },
  { level: 5, xp: 1000 },
  { level: 6, xp: 1500 },
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
  return 50 * level
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

/** Server-side reward from validated timing; null = inhuman, no pay. */
export function rewardForReaction(ms: number): number | null {
  if (!Number.isFinite(ms) || ms < REACTION_MIN_MS) return null
  for (const tier of REACTION_TIERS) {
    if (ms <= tier.maxMs) return tier.reward
  }
  return null
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

/** Server-side tap-frenzy reward from a validated count. */
export function rewardForTaps(count: number): number | null {
  if (!Number.isInteger(count) || count < TAPS_MIN_TAPS || count > TAPS_MAX_TAPS) return null
  for (const tier of TAPS_TIERS) {
    if (count >= tier.minTaps) return tier.reward
  }
  return null
}

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
  return value === 'reaction' || value === 'typing' || value === 'taps' ? value : null
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

async function payOut(
  db: D1Database,
  userId: string,
  game: string,
  roundId: string,
  detail: string,
  reward: number,
  timestamp: number,
): Promise<number> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
         VALUES (?, ?, ?, 'game_reward', ?, ?)`,
      )
      .bind(newId(), userId, reward, JSON.stringify({ game, round_id: roundId, detail }), timestamp),
    db.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?').bind(
      reward,
      timestamp,
      userId,
    ),
  ])
  const balance = await db
    .prepare('SELECT balance_credits FROM freellm_users WHERE id = ?')
    .bind(userId)
    .first<{ balance_credits: number }>()
  return balance?.balance_credits ?? 0
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
    reaction_tiers: REACTION_TIERS.map((t) => ({ within_ms: t.maxMs, reward: t.reward })),
    reaction_min_ms: REACTION_MIN_MS,
  })
})

// Back-compat: the reaction game previously had its own status shape.
app.get('/api/games/reaction/status', requireAuth, async (c) => {
  const user = c.get('user')
  const used = await paidPlaysToday(c.env.DB, user.id, 'reaction')
  const earned = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(reward), 0) AS earned FROM freellm_game_rounds
     WHERE user_id = ? AND game = 'reaction' AND claimed_at IS NOT NULL AND claimed_at >= ?`,
  )
    .bind(user.id, dayStartMs())
    .first<{ earned: number }>()
  return c.json({
    plays_left: Math.max(0, REACTION_USER_DAILY_PLAYS - used),
    plays_cap: REACTION_USER_DAILY_PLAYS,
    earned_today: earned?.earned ?? 0,
    tiers: REACTION_TIERS.map((t) => ({ within_ms: t.maxMs, reward: t.reward })),
    min_ms: REACTION_MIN_MS,
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
  const detail = game === 'typing' ? TYPING_PHRASES[Math.floor(Math.random() * TYPING_PHRASES.length)] : null
  await c.env.DB.prepare('INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, reward) VALUES (?, ?, ?, ?, ?, 0)')
    .bind(id, user.id, game, detail, timestamp)
    .run()
  // Reaction timing and tap counts are measured client-side and validated on
  // claim; the typing phrase must come from the server so pasting a foreign
  // text cannot score.
  return c.json(game === 'typing' ? { round_id: id, phrase: detail } : { round_id: id }, 201)
})

// Back-compat shims for the first-generation reaction endpoints.
app.post('/api/games/reaction/start', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = verifiedGate(user)
  if (gate) return c.json(gate, 403)
  const id = newId()
  const timestamp = now()
  await c.env.DB.prepare('INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, reward) VALUES (?, ?, ?, ?, ?, 0)')
    .bind(id, user.id, 'reaction', null, timestamp)
    .run()
  return c.json({ round_id: id }, 201)
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
  const round = await c.env.DB.prepare('SELECT user_id, game, detail, created_at FROM freellm_game_rounds WHERE id = ?')
    .bind(roundId)
    .first<{ user_id: string; game: string; detail: string | null; created_at: number }>()
  if (!round || round.user_id !== user.id || round.game !== game) {
    return c.json({ error: 'not_found', message: 'Round not found.' }, 404)
  }
  const ageMs = timestamp - round.created_at

  // Per-game server-side scoring from validated input.
  let reward: number | null = null
  let detail = ''
  if (game === 'reaction') {
    const ms = typeof body?.reaction_ms === 'number' ? body.reaction_ms : NaN
    if (!round || ageMs > REACTION_ROUND_TTL_MS) {
      return c.json({ error: 'expired', message: 'Round expired — start a fresh one.' }, 410)
    }
    reward = rewardForReaction(ms)
    detail = `reaction_ms:${Number.isFinite(ms) ? Math.floor(ms) : 'nan'}`
    if (reward === null) {
      return c.json({ error: 'invalid_time', message: 'That timing is outside the human window (120ms–5s) — no pay, try again.' }, 422)
    }
  } else if (game === 'typing') {
    const typed = typeof body?.typed === 'string' ? body.typed : null
    if (typed === null || !round.detail || typed !== round.detail) {
      return c.json({ error: 'mismatch', message: 'Typed text must match the given phrase exactly — no pay, try again.' }, 422)
    }
    const seconds = ageMs / 1000
    reward = rewardForTyping(round.detail.length, seconds)
    detail = `wpm:${(round.detail.length / 5 / (seconds / 60)).toFixed(1)}`
    if (reward === null) {
      return c.json({ error: 'invalid_time', message: 'Too fast to be typing or too slow to count — no pay, try again.' }, 422)
    }
  } else {
    const count = typeof body?.count === 'number' ? body.count : NaN
    if (ageMs < TAPS_WINDOW_MS || ageMs > TAPS_WINDOW_MS + TAPS_SLACK_MS) {
      return c.json({ error: 'expired', message: 'Tap window missed — start a fresh round.' }, 410)
    }
    reward = rewardForTaps(count)
    detail = `taps:${Number.isInteger(count) ? count : 'nan'}`
    if (reward === null) {
      return c.json({ error: 'invalid_count', message: 'Tap counts must be 5–60 in 5 seconds — no pay, try again.' }, 422)
    }
  }

  // Daily caps first (bounded TOCTOU race, same as every grant endpoint),
  // then the conditional claim so a capped-out round is never marked.
  const used = await paidPlaysToday(c.env.DB, user.id, game)
  if (used >= GAME_DAILY_CAPS[game]) {
    return c.json({ error: 'daily_cap', message: 'Daily play budget spent — come back tomorrow.' }, 409)
  }
  const spent = await globalSpentToday(c.env.DB)
  if (spent + reward > REACTION_GLOBAL_DAILY_BUDGET) {
    return c.json({ error: 'pot_empty', message: "Today's arcade pot is empty — come back tomorrow." }, 409)
  }

  // Conditional claim: exactly one winner per round, race-safe.
  const claimed = (await c.env.DB.prepare(
    'UPDATE freellm_game_rounds SET claimed_at = ?, reaction_ms = ?, reward = ? WHERE id = ? AND claimed_at IS NULL',
  )
    .bind(timestamp, game === 'reaction' && typeof body?.reaction_ms === 'number' ? Math.floor(body.reaction_ms) : null, reward, roundId)
    .run() as unknown as { meta?: { changes?: number } })
  if (typeof claimed?.meta?.changes === 'number' && claimed.meta.changes === 0) {
    return c.json({ error: 'already_claimed', message: 'Round already claimed.' }, 409)
  }

  const balance = await payOut(c.env.DB, user.id, game, roundId, detail, reward, timestamp)
  return c.json({ ok: true, reward, balance })
})

// Back-compat shim for first-generation reaction claims.
app.post('/api/games/reaction/claim', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = verifiedGate(user)
  if (gate) return c.json(gate, 403)

  const body = await c.req.json<{ round_id?: unknown; reaction_ms?: unknown }>().catch(() => null)
  const roundId = typeof body?.round_id === 'string' ? body.round_id : ''
  const reactionMs = typeof body?.reaction_ms === 'number' ? body.reaction_ms : NaN
  if (!roundId || !Number.isFinite(reactionMs)) {
    return c.json({ error: 'invalid_input', message: 'round_id and reaction_ms are required.' }, 400)
  }

  const reward = rewardForReaction(reactionMs)
  if (reward === null) {
    return c.json({ error: 'invalid_time', message: 'That timing is outside the human window (120ms–5s) — no pay, try again.' }, 422)
  }

  const timestamp = now()
  const round = await c.env.DB.prepare('SELECT user_id, game, created_at FROM freellm_game_rounds WHERE id = ?')
    .bind(roundId)
    .first<{ user_id: string; game: string; created_at: number }>()
  if (!round || round.user_id !== user.id || (round.game !== 'reaction' && round.game !== null)) {
    return c.json({ error: 'not_found', message: 'Round not found.' }, 404)
  }
  if (timestamp - round.created_at > REACTION_ROUND_TTL_MS) {
    return c.json({ error: 'expired', message: 'Round expired — start a fresh one.' }, 410)
  }

  const used = await paidPlaysToday(c.env.DB, user.id, 'reaction')
  if (used >= REACTION_USER_DAILY_PLAYS) {
    return c.json({ error: 'daily_cap', message: 'Daily play budget spent — come back tomorrow.' }, 409)
  }
  const spent = await globalSpentToday(c.env.DB)
  if (spent + reward > REACTION_GLOBAL_DAILY_BUDGET) {
    return c.json({ error: 'pot_empty', message: "Today's arcade pot is empty — come back tomorrow." }, 409)
  }

  const claimed = (await c.env.DB.prepare(
    'UPDATE freellm_game_rounds SET claimed_at = ?, reaction_ms = ?, reward = ? WHERE id = ? AND claimed_at IS NULL',
  )
    .bind(timestamp, Math.floor(reactionMs), reward, roundId)
    .run() as unknown as { meta?: { changes?: number } })
  if (typeof claimed?.meta?.changes === 'number' && claimed.meta.changes === 0) {
    return c.json({ error: 'already_claimed', message: 'Round already claimed.' }, 409)
  }

  const balance = await payOut(c.env.DB, user.id, 'reaction', roundId, `reaction_ms:${Math.floor(reactionMs)}`, reward, timestamp)
  return c.json({ ok: true, reward, reaction_ms: Math.floor(reactionMs), balance })
})

// ------------------------------------------------------------ clear bonus

app.post('/api/games/clear/claim', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = verifiedGate(user)
  if (gate) return c.json(gate, 403)

  // One paid play in each game today, and no clear bonus yet today.
  for (const game of CLEAR_GAMES) {
    if ((await paidPlaysToday(c.env.DB, user.id, game)) === 0) {
      return c.json({ error: 'not_cleared', message: 'Finish all three games today to claim the clear bonus.' }, 409)
    }
  }
  const existing = await c.env.DB.prepare(
    `SELECT 1 AS x FROM freellm_game_rounds WHERE user_id = ? AND game = 'clear' AND claimed_at >= ?`,
  )
    .bind(user.id, dayStartMs())
    .first()
  if (existing) return c.json({ error: 'already_claimed', message: 'Clear bonus already claimed today.' }, 409)

  const timestamp = now()
  const id = newId()
  await c.env.DB.prepare(
    'INSERT INTO freellm_game_rounds (id, user_id, game, detail, created_at, claimed_at, reward) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, user.id, 'clear', 'daily-clear', timestamp, timestamp, CLEAR_BONUS_REWARD)
    .run()
  const balance = await payOut(c.env.DB, user.id, 'clear', id, 'daily-clear', CLEAR_BONUS_REWARD, timestamp)
  return c.json({ ok: true, reward: CLEAR_BONUS_REWARD, balance })
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
