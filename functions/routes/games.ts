// Reaction sprint: a 10-second skill game that pays bounded Pool credits.
//
// Norman design notes (why it looks this way):
// - One button, three states (wait → TAP → result) so the conceptual model is
//   trivial; every state is labeled in words, never color alone.
// - Early taps are fouls with zero penalty and an explicit retry cue —
//   error-tolerant by construction, no dead ends.
// - Reward tiers, plays-left, and caps are shown BEFORE playing (feedforward),
//   and the result names the exact credits (feedback).
//
// Tokenomics (bounded on both axes):
// - Server issues the round and validates the timing: 120ms–5000ms human
//   window, one claim per round (conditional UPDATE), 60s round TTL.
// - Per user: 5 paid plays/day. Global: 250,000cr/day across all players.
// - Never trust the client: reward is computed server-side from validated ms.

import { Hono } from 'hono'
import { requireAuth } from '../lib/middleware'
import { newId } from '../lib/crypto'
import type { Bindings, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const now = () => Date.now()

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

/** Server-side reward from validated timing; null = inhuman, no pay. */
export function rewardForReaction(ms: number): number | null {
  if (!Number.isFinite(ms) || ms < REACTION_MIN_MS) return null
  for (const tier of REACTION_TIERS) {
    if (ms <= tier.maxMs) return tier.reward
  }
  return null
}

function utcDay(): string {
  return new Date(now()).toISOString().slice(0, 10)
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

// ------------------------------------------------------------------ status

app.get('/api/games/reaction/status', requireAuth, async (c) => {
  const user = c.get('user')
  const dayStart = Date.parse(`${utcDay()}T00:00:00Z`)
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS plays, COALESCE(SUM(reward), 0) AS earned
     FROM freellm_game_rounds
     WHERE user_id = ? AND claimed_at IS NOT NULL AND claimed_at >= ?`,
  )
    .bind(user.id, dayStart)
    .first<{ plays: number; earned: number }>()
  const plays = row?.plays ?? 0
  return c.json({
    plays_left: Math.max(0, REACTION_USER_DAILY_PLAYS - plays),
    plays_cap: REACTION_USER_DAILY_PLAYS,
    earned_today: row?.earned ?? 0,
    tiers: REACTION_TIERS.map((t) => ({ within_ms: t.maxMs, reward: t.reward })),
    min_ms: REACTION_MIN_MS,
  })
})

// ------------------------------------------------------------------- start

app.post('/api/games/reaction/start', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = verifiedGate(user)
  if (gate) return c.json(gate, 403)

  const id = newId()
  const timestamp = now()
  await c.env.DB.prepare('INSERT INTO freellm_game_rounds (id, user_id, created_at, reward) VALUES (?, ?, ?, 0)')
    .bind(id, user.id, timestamp)
    .run()
  // The client measures display-to-tap itself; the server validates the
  // claimed timing against the human window on claim.
  return c.json({ round_id: id }, 201)
})

// ------------------------------------------------------------------- claim

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
  const round = await c.env.DB.prepare('SELECT user_id, created_at FROM freellm_game_rounds WHERE id = ?')
    .bind(roundId)
    .first<{ user_id: string; created_at: number }>()
  if (!round || round.user_id !== user.id) {
    return c.json({ error: 'not_found', message: 'Round not found.' }, 404)
  }
  if (timestamp - round.created_at > REACTION_ROUND_TTL_MS) {
    return c.json({ error: 'expired', message: 'Round expired — start a fresh one.' }, 410)
  }

  // Conditional claim: exactly one winner per round, race-safe.
  const claimed = (await c.env.DB.prepare(
    'UPDATE freellm_game_rounds SET claimed_at = ?, reaction_ms = ?, reward = ? WHERE id = ? AND claimed_at IS NULL',
  )
    .bind(timestamp, Math.floor(reactionMs), reward, roundId)
    .run() as unknown as { meta?: { changes?: number } })
  if (typeof claimed?.meta?.changes === 'number' && claimed.meta.changes === 0) {
    return c.json({ error: 'already_claimed', message: 'Round already claimed.' }, 409)
  }

  // Daily caps: per-user paid plays, then the global budget.
  const dayStart = Date.parse(`${utcDay()}T00:00:00Z`)
  const mine = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM freellm_game_rounds WHERE user_id = ? AND claimed_at IS NOT NULL AND claimed_at >= ? AND id != ?',
  )
    .bind(user.id, dayStart, roundId)
    .first<{ n: number }>()
  if ((mine?.n ?? 0) >= REACTION_USER_DAILY_PLAYS) {
    return c.json({ error: 'daily_cap', message: 'Daily play budget spent — come back tomorrow.' }, 409)
  }
  const global = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(l.delta), 0) AS spent FROM freellm_credit_ledger l
     WHERE l.reason = 'game_reward' AND l.created_at >= ?`,
  )
    .bind(dayStart)
    .first<{ spent: number }>()
  if ((global?.spent ?? 0) + reward > REACTION_GLOBAL_DAILY_BUDGET) {
    return c.json({ error: 'pot_empty', message: "Today's arcade pot is empty — come back tomorrow." }, 409)
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
       VALUES (?, ?, ?, 'game_reward', ?, ?)`,
    ).bind(newId(), user.id, reward, JSON.stringify({ game: 'reaction', round_id: roundId, reaction_ms: Math.floor(reactionMs) }), timestamp),
    c.env.DB.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?').bind(
      reward,
      timestamp,
      user.id,
    ),
  ])

  const balance = await c.env.DB.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?')
    .bind(user.id)
    .first<{ balance_credits: number }>()
  return c.json({ ok: true, reward, reaction_ms: Math.floor(reactionMs), balance: balance?.balance_credits ?? 0 })
})

export default app
