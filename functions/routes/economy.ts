// The economy: earning mechanics.
//
//   POST /api/checkin              daily check-in: +50,000 base + streak milestones
//   GET  /api/earn                 aggregate state for the /earn page
//   GET  /api/referrals            referral stats + live qualification progress
//   GET  /api/tasks                task list with completion state
//   POST /api/tasks/:slug/complete claim a task reward
//   GET  /api/usage                usage dashboard (per-model spend, burn rate)
//   GET  /api/ledger               credit ledger history
//
// Earning requires a verified email — the anti-farming gate.

import { Hono } from 'hono'
import { requireAuth } from '../lib/middleware'
import { newId } from '../lib/crypto'
import type { Bindings, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const now = () => Date.now()

// Economy constants — the single source of truth, mirrored in the UI.
export const CHECKIN_BASE_REWARD = 50_000
export const CHECKIN_MILESTONES = [
  { day: 7, bonus: 500_000 },
  { day: 30, bonus: 2_000_000 },
]
export const REFERRAL_REWARD = 500_000
export const REFERRAL_TENURE_DAYS = 7
export const REFERRAL_TOKENS = 200_000

const utcDate = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10)

const VERIFIED_REQUIRED = {
  error: 'verification_required',
  message: 'Verify your email to earn credits. Check your inbox for the link.',
}

/** 403s unless the user's email is verified. */
function requireVerified(user: { email_verified: number }): Response | null {
  if (user.email_verified !== 1) {
    return new Response(JSON.stringify(VERIFIED_REQUIRED), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}

/**
 * Pays REFERRAL_REWARD to `referrerId` for each of their waiting referrals
 * whose referred user has hit the milestone (7-day tenure OR 200K tokens).
 * Returns the number paid.
 */
export async function qualifyReferrals(db: D1Database, referrerId: string): Promise<number> {
  const waiting = await db
    .prepare(
      `SELECT r.id, r.referred_id, u.created_at
       FROM freellm_referrals r JOIN freellm_users u ON u.id = r.referred_id
       WHERE r.referrer_id = ? AND r.status = 'waiting'`,
    )
    .bind(referrerId)
    .all<{ id: string; referred_id: string; created_at: number }>()

  let paid = 0
  for (const row of waiting.results) {
    const tenureDays = (now() - row.created_at) / 86_400_000
    const usage = await db
      .prepare(
        "SELECT COALESCE(SUM(total_tokens), 0) AS tokens FROM freellm_usage_events WHERE user_id = ? AND total_tokens IS NOT NULL AND status = 'completed' AND key_mode = 'pool'",
      )
      .bind(row.referred_id)
      .first<{ tokens: number }>()
    const tokensUsed = usage?.tokens ?? 0
    if (tenureDays < REFERRAL_TENURE_DAYS && tokensUsed < REFERRAL_TOKENS) continue

    const timestamp = now()
    // Claim + payout in ONE batch: the claim UPDATE is the race gate (only
    // the winner flips a row from 'waiting'), and both grant statements are
    // conditioned on the marker it writes — so a crash between the claim
    // and the payout can no longer strand a paid-marked referral with no
    // credits, and a losing racer mints nothing. The deterministic ledger
    // id (one per referral row) is the backstop for same-millisecond
    // collisions: the loser's insert violates the PRIMARY KEY, the batch
    // rolls back, and we treat it as already paid.
    let claimResult: Array<{ success: boolean; meta?: { changes?: number } }>
    try {
      claimResult = (await db.batch([
        db
          .prepare("UPDATE freellm_referrals SET status = 'paid', qualified_at = ?, paid_at = ?, reward = ? WHERE id = ? AND status = 'waiting'")
          .bind(timestamp, timestamp, REFERRAL_REWARD, row.id),
        db
          .prepare(
            `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
             SELECT ?, ?, ?, 'referral_reward', ?, ?
             WHERE EXISTS (SELECT 1 FROM freellm_referrals WHERE id = ? AND status = 'paid' AND paid_at = ?)`,
          )
          .bind(
            `referral_reward:${row.id}`,
            referrerId,
            REFERRAL_REWARD,
            JSON.stringify({ referred_id: row.referred_id, milestone: { tenure_days: Math.floor(tenureDays), tokens_used: tokensUsed } }),
            timestamp,
            row.id,
            timestamp,
          ),
        db
          .prepare(
            `UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ?
             WHERE id = ? AND EXISTS (SELECT 1 FROM freellm_referrals WHERE id = ? AND status = 'paid' AND paid_at = ?)`,
          )
          .bind(REFERRAL_REWARD, timestamp, referrerId, row.id, timestamp),
      ])) as unknown as Array<{ success: boolean; meta?: { changes?: number } }>
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_credit_ledger')) {
        continue
      }
      throw err
    }
    if (!claimResult[0]?.success || claimResult[0].meta?.changes === 0) continue
    paid += 1
  }
  return paid
}

/**
 * Called when a user does something notable (check-in, chat): if someone
 * referred them, sweep that referrer's waiting freellm_referrals so the payout is not
 * delayed until the referrer happens to visit /earn.
 */
export async function qualifyForReferredUser(db: D1Database, referredUserId: string): Promise<number> {
  const row = await db
    .prepare("SELECT referrer_id FROM freellm_referrals WHERE referred_id = ? AND status = 'waiting'")
    .bind(referredUserId)
    .first<{ referrer_id: string }>()
  if (!row) return 0
  return qualifyReferrals(db, row.referrer_id)
}

// =====================================================================
// Check-in
// =====================================================================

app.post('/api/checkin', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = requireVerified(user)
  if (gate) return gate

  const today = utcDate(now())
  const existing = await c.env.DB.prepare('SELECT streak, reward FROM freellm_checkins WHERE user_id = ? AND checkin_date = ?')
    .bind(user.id, today)
    .first<{ streak: number; reward: number }>()
  if (existing) {
    return c.json({
      already_checked_in: true,
      streak: existing.streak,
      reward: existing.reward,
      balance: user.balance_credits,
    })
  }

  const yesterday = utcDate(now() - 86_400_000)
  const last = await c.env.DB.prepare('SELECT streak FROM freellm_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1')
    .bind(user.id)
    .first<{ streak: number }>()
  const streak = last && (await checkedInOn(c.env.DB, user.id, yesterday)) ? last.streak + 1 : 1

  const milestone = CHECKIN_MILESTONES.find((m) => m.day === streak)
  const reward = CHECKIN_BASE_REWARD + (milestone?.bonus ?? 0)

  const timestamp = now()
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO freellm_checkins (user_id, checkin_date, streak, reward, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(user.id, today, streak, reward, timestamp),
      c.env.DB.prepare(
        "INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at) VALUES (?, ?, ?, 'daily_checkin', ?, ?)",
      ).bind(
        newId(),
        user.id,
        reward,
        JSON.stringify({ streak, day_reward: CHECKIN_BASE_REWARD, milestone_bonus: milestone?.bonus ?? 0 }),
        timestamp,
      ),
      c.env.DB.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?').bind(
        reward,
        timestamp,
        user.id,
      ),
    ])
  } catch (err) {
    // Concurrent double check-in won the PK race — replay as idempotent.
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_checkins')) {
      const winner = await c.env.DB.prepare('SELECT streak, reward FROM freellm_checkins WHERE user_id = ? AND checkin_date = ?')
        .bind(user.id, today)
        .first<{ streak: number; reward: number }>()
      if (winner) {
        return c.json({ already_checked_in: true, streak: winner.streak, reward: winner.reward, balance: user.balance_credits })
      }
    }
    throw err
  }

  // A day-1 check-in can push the referred user past the tenure milestone.
  await qualifyForReferredUser(c.env.DB, user.id)

  return c.json({
    already_checked_in: false,
    streak,
    reward,
    milestone: milestone ?? null,
    balance: user.balance_credits + reward,
  })
})

async function checkedInOn(db: D1Database, userId: string, date: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS x FROM freellm_checkins WHERE user_id = ? AND checkin_date = ?').bind(userId, date).first()
  return !!row
}

async function checkinState(db: D1Database, userId: string) {
  const today = utcDate(now())
  const rows = await db
    .prepare(
      "SELECT checkin_date, streak, reward FROM freellm_checkins WHERE user_id = ? AND checkin_date >= date('now', '-6 days') ORDER BY checkin_date DESC",
    )
    .bind(userId)
    .all<{ checkin_date: string; streak: number; reward: number }>()

  const last = rows.results[0]
  const checkedInToday = last?.checkin_date === today
  const streak = checkedInToday ? last.streak : 0
  const streakIfCheckedIn = streak + 1
  const nextMilestone = CHECKIN_MILESTONES.find((m) => m.day > streak) ?? null
  const bonusIfCheckedIn = nextMilestone && nextMilestone.day === streakIfCheckedIn ? nextMilestone.bonus : 0

  return {
    checked_in_today: checkedInToday,
    streak,
    streak_if_checked_in: streakIfCheckedIn,
    today_reward: CHECKIN_BASE_REWARD + bonusIfCheckedIn,
    calendar: rows.results.map((r) => r.checkin_date),
    milestones: CHECKIN_MILESTONES,
    next_milestone: nextMilestone ? { ...nextMilestone, days_away: nextMilestone.day - streak } : null,
  }
}

// =====================================================================
// Earn aggregate (drives the whole /earn page in one request)
// =====================================================================

app.get('/api/earn', requireAuth, async (c) => {
  const user = c.get('user')

  // Lazy qualification sweep: pay any referrers whose referred user matured.
  await qualifyReferrals(c.env.DB, user.id)

  const [checkin, referralRows, tasks] = await Promise.all([
    checkinState(c.env.DB, user.id),
    c.env.DB.prepare(
      `SELECT r.id, r.referred_id, r.status, r.reward, u.username, u.created_at
       FROM freellm_referrals r JOIN freellm_users u ON u.id = r.referred_id
       WHERE r.referrer_id = ? ORDER BY r.created_at DESC LIMIT 50`,
    )
      .bind(user.id)
      .all<{
        id: string
        referred_id: string
        status: string
        reward: number | null
        username: string
        created_at: number
      }>(),
    c.env.DB.prepare('SELECT * FROM freellm_tasks WHERE active = 1 ORDER BY sort_order').all<{
      id: string
      slug: string
      title: string
      description: string | null
      reward: number
      url: string | null
    }>(),
  ])

  const completions = await c.env.DB.prepare('SELECT task_id FROM freellm_task_completions WHERE user_id = ?')
    .bind(user.id)
    .all<{ task_id: string }>()
  const completionsSet = new Set(completions.results.map((r) => r.task_id))

  const origin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin
  const rows = await Promise.all(
    referralRows.results.map(async (row) => {
      const usage = await c.env.DB.prepare(
        "SELECT COALESCE(SUM(total_tokens), 0) AS tokens FROM freellm_usage_events WHERE user_id = ? AND status = 'completed' AND key_mode = 'pool'",
      )
        .bind(row.referred_id)
        .first<{ tokens: number }>()
      const tenureDays = Math.floor((now() - row.created_at) / 86_400_000)
      const tokensUsed = usage?.tokens ?? 0
      const progressPct = Math.min(
        100,
        Math.max((tenureDays / REFERRAL_TENURE_DAYS) * 100, (tokensUsed / REFERRAL_TOKENS) * 100),
      )
      return {
        username: row.username,
        status: row.status,
        reward: row.reward,
        tenure_days: tenureDays,
        tokens_used: tokensUsed,
        progress_pct: Math.round(progressPct),
        milestone: { tenure_days: REFERRAL_TENURE_DAYS, tokens: REFERRAL_TOKENS },
      }
    }),
  )

  const qualified = rows.filter((r) => r.status === 'paid').length

  return c.json({
    verified: user.email_verified === 1,
    checkin,
    referral: {
      code: user.referral_code,
      link: `${origin}/r/${user.referral_code}`,
      qualified,
      pending: rows.length - qualified,
      total_earned: qualified * REFERRAL_REWARD,
      reward: REFERRAL_REWARD,
      rows,
    },
    tasks: tasks.results.map((t) => ({ ...t, completed: completionsSet.has(t.id) })),
  })
})

// =====================================================================
// Referrals (standalone view; /api/earn has the same data)
// =====================================================================

app.get('/api/referrals', requireAuth, async (c) => {
  const user = c.get('user')
  await qualifyReferrals(c.env.DB, user.id)
  const origin = c.env.PUBLIC_ORIGIN ?? new URL(c.req.url).origin
  return c.json({
    code: user.referral_code,
    link: `${origin}/r/${user.referral_code}`,
    reward: REFERRAL_REWARD,
    milestone: { tenure_days: REFERRAL_TENURE_DAYS, tokens: REFERRAL_TOKENS },
  })
})

// =====================================================================
// Tasks
// =====================================================================

app.get('/api/tasks', requireAuth, async (c) => {
  const user = c.get('user')
  const [tasks, completions] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM freellm_tasks WHERE active = 1 ORDER BY sort_order').all<{
      id: string
      slug: string
      title: string
      description: string | null
      reward: number
      url: string | null
    }>(),
    c.env.DB.prepare('SELECT task_id FROM freellm_task_completions WHERE user_id = ?').bind(user.id).all<{ task_id: string }>(),
  ])
  const done = new Set(completions.results.map((r) => r.task_id))
  return c.json({
    verified: user.email_verified === 1,
    tasks: tasks.results.map((t) => ({ ...t, completed: done.has(t.id) })),
  })
})

app.post('/api/tasks/:slug/complete', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = requireVerified(user)
  if (gate) return gate

  const slug = c.req.param('slug')
  const task = await c.env.DB.prepare('SELECT * FROM freellm_tasks WHERE slug = ? AND active = 1')
    .bind(slug)
    .first<{ id: string; slug: string; reward: number }>()
  if (!task) return c.json({ error: 'not_found', message: 'Task not found.' }, 404)

  // GitHub star validation: require recent visit to https://github.com/hasitpbhatt/codewhip
  const visited = await c.env.DB.prepare(
    `SELECT visited_at FROM freellm_user_visits WHERE user_id = ? AND url = ?`
  )
    .bind(user.id, 'https://github.com/hasitpbhatt/codewhip')
    .first<{ visited_at: number }>()
  const recent = visited && now() - visited.visited_at <= 7_200_000 // 2h window
  if (!recent) {
    return c.json({ error: 'visit_required', message: 'Please visit https://github.com/hasitpbhatt/codewhip and star CodeWhip, then try again.' }, 409)
  }

  const claimed = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM freellm_task_completions WHERE user_id = ? AND task_id = ?'
  )
    .bind(user.id, task.id)
    .first<{ n: number }>()
  if ((claimed?.n ?? 0) >= 1) {
    return c.json({ error: 'already_completed', message: 'Task already claimed.' }, 409)
  }

  const timestamp = now()
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO freellm_task_completions (user_id, task_id, reward, created_at) VALUES (?, ?, ?, ?)')
        .bind(user.id, task.id, task.reward, timestamp),
      c.env.DB.prepare(
        "INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at) VALUES (?, ?, ?, 'task_reward', ?, ?)"
      ).bind(newId(), user.id, task.reward, JSON.stringify({ task_id: task.id, slug: task.slug }), timestamp),
      c.env.DB.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?')
        .bind(task.reward, timestamp, user.id),
    ])
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_task_completions')) {
      return c.json({ error: 'already_completed', message: 'Task already claimed.' }, 409)
    }
    throw err
  }

  return c.json({ ok: true, reward: task.reward, balance: user.balance_credits + task.reward })

// =====================================================================
// Usage dashboard
// =====================================================================
})
app.get('/api/usage', requireAuth, async (c) => {
  const user = c.get('user')

  const [perModel, recent, daily] = await Promise.all([
    c.env.DB.prepare(
      `SELECT model,
              COUNT(*) AS messages,
              SUM(credits_charged) AS credits,
              SUM(total_tokens) AS tokens,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(CASE WHEN source = 'flat_rate' THEN 1 ELSE 0 END) AS flat_rate_messages
       FROM freellm_usage_events WHERE user_id = ? AND status != 'failed'
       GROUP BY model ORDER BY credits DESC`,
    )
      .bind(user.id)
      .all<{
        model: string
        messages: number
        credits: number
        tokens: number | null
        input_tokens: number | null
        output_tokens: number | null
        flat_rate_messages: number
      }>(),
    c.env.DB.prepare(
      `SELECT model, source, status, input_tokens, output_tokens, total_tokens, credits_charged, latency_ms, created_at
       FROM freellm_usage_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`,
    )
      .bind(user.id)
      .all<{
        model: string
        source: string
        status: string
        input_tokens: number | null
        output_tokens: number | null
        total_tokens: number | null
        credits_charged: number
        latency_ms: number | null
        created_at: number
      }>(),
    c.env.DB.prepare(
      `SELECT date(created_at / 1000, 'unixepoch') AS day, SUM(credits_charged) AS credits, COUNT(*) AS messages
       FROM freellm_usage_events WHERE user_id = ? AND status != 'failed' AND created_at > ?
       GROUP BY day ORDER BY day`,
    )
      .bind(user.id, now() - 14 * 86_400_000)
      .all<{ day: string; credits: number; messages: number }>(),
  ])

  // Burn rate: average per active day over the last 7 days of history.
  const week = daily.results.slice(-7)
  const activeDays = week.length
  const weekCredits = week.reduce((sum, d) => sum + (d.credits ?? 0), 0)
  const avgDailyBurn = activeDays > 0 ? Math.round(weekCredits / activeDays) : 0

  const grant = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(credits), 0) AS scoped FROM freellm_model_credit_grants WHERE user_id = ?',
  )
    .bind(user.id)
    .first<{ scoped: number }>()

  const total = user.balance_credits + (grant?.scoped ?? 0)
  const daysRemaining = avgDailyBurn > 0 ? Math.floor(total / avgDailyBurn) : null

  return c.json({
    totals: {
      credits_spent: perModel.results.reduce((sum, m) => sum + (m.credits ?? 0), 0),
      messages: perModel.results.reduce((sum, m) => sum + (m.messages ?? 0), 0),
      tokens_reported: perModel.results.reduce((sum, m) => sum + (m.tokens ?? 0), 0),
    },
    balance: { global: user.balance_credits, scoped: grant?.scoped ?? 0, total },
    per_model: perModel.results,
    daily: daily.results,
    burn: { avg_daily: avgDailyBurn, days_remaining: daysRemaining, window_days: 7 },
    recent: recent.results,
  })
})

// =====================================================================
// Ledger
// =====================================================================

app.get('/api/ledger', requireAuth, async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    'SELECT delta, reason, meta, created_at FROM freellm_credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
  )
    .bind(user.id)
    .all<{ delta: number; reason: string; meta: string | null; created_at: number }>()

  return c.json({
    entries: rows.results.map((row) => ({
      delta: row.delta,
      reason: row.reason,
      meta: row.meta ? safeParse(row.meta) : null,
      created_at: row.created_at,
    })),
  })
})

function safeParse(json: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export default app
