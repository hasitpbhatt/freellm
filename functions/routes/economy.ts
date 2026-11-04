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

// Double-sided referral milestone rewards (sum = REFERRAL_REWARD each side)
export const REFERRAL_MILESTONES = [
  { type: 'signup', label: 'Friend signs up & verifies', referrer: 50_000, referred: 50_000 },
  { type: 'day1_checkin', label: 'Friend checks in on day 1', referrer: 25_000, referred: 25_000 },
  { type: 'tenure_7', label: 'Friend hits 7-day streak', referrer: 200_000, referred: 200_000 },
  { type: 'tokens_200k', label: 'Friend uses 200k Pool tokens', referrer: 225_000, referred: 225_000 },
] as const

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

// =====================================================================
// Weekly Quests helpers (defined before app routes so they can be imported)
// =====================================================================

// Calculate week boundaries (Monday 00:00 UTC)
export function weekBounds(timestamp: number): { weekStart: number; weekEnd: number; weekKey: string } {
  const d = new Date(timestamp)
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday
  const diff = day === 0 ? -6 : 1 - day // days to last Monday
  const weekStart = new Date(d.getTime() + diff * 86_400_000)
  weekStart.setUTCHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000)
  const year = weekStart.getUTCFullYear()
  const weekNum = Math.ceil((weekStart.getTime() - new Date(year, 0, 1).getTime()) / 604_800_000)
  return { weekStart: weekStart.getTime(), weekEnd: weekEnd.getTime(), weekKey: `${year}:${weekNum}` }
}

// Quest definitions — mirrored in UI
export const WEEKLY_QUEST_DEFINITIONS = [
  { slug: 'typing_80wpm', title: 'Speed Demon', description: 'Hit 80 WPM in a Typing game', target: 80, reward: 50_000, type: 'typing_wpm' },
  { slug: 'memory_perfect', title: 'Perfect Memory', description: 'Complete Memory game in ≤8 moves', target: 8, reward: 50_000, type: 'memory_moves' },
  { slug: 'streak_7', title: 'Week Warrior', description: 'Maintain a 7-day check-in streak this week', target: 7, reward: 75_000, type: 'checkin_streak' },
  { slug: 'referral_1', title: 'Connector', description: 'Refer 1 friend who verifies email', target: 1, reward: 100_000, type: 'referral_signups' },
  { slug: 'pool_50k', title: 'Pool Shark', description: 'Use 50,000 Pool tokens', target: 50_000, reward: 75_000, type: 'pool_tokens_used' },
] as const

// Ensure weekly quests exist for current week
export async function ensureWeeklyQuests(db: D1Database, weekStart: number, weekEnd: number, weekKey: string): Promise<void> {
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM freellm_weekly_quests WHERE week_start = ?').bind(weekStart).first<{ n: number }>()
  if (existing && existing.n > 0) return

  const timestamp = now()
  const statements = WEEKLY_QUEST_DEFINITIONS.map((q) =>
    db.prepare(
      `INSERT INTO freellm_weekly_quests (id, week_start, week_end, slug, title, description, target_value, reward, quest_type, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).bind(`weekly_quest:${weekKey}:${q.slug}`, weekStart, weekEnd, q.slug, q.title, q.description, q.target, q.reward, q.type, timestamp)
  )
  await db.batch(statements)
}

// Helper: update weekly quest progress
export async function updateWeeklyQuestProgress(
  db: D1Database,
  userId: string,
  questType: string,
  value: number
): Promise<void> {
  const { weekStart } = weekBounds(now())

  // Ensure quests exist for this week
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM freellm_weekly_quests WHERE week_start = ?').bind(weekStart).first<{ n: number }>()
  if (!existing || existing.n === 0) return

  const quest = await db.prepare('SELECT id, target_value FROM freellm_weekly_quests WHERE week_start = ? AND quest_type = ?').bind(weekStart, questType).first<{ id: string; target_value: number }>()
  if (!quest) return

  const progress = await db.prepare('SELECT current_value, completed FROM freellm_weekly_quest_progress WHERE user_id = ? AND quest_id = ?').bind(userId, quest.id).first<{ current_value: number; completed: number }>()

  const newValue = Math.max(progress?.current_value ?? 0, value)
  const completed = newValue >= quest.target_value ? 1 : 0

  if (progress) {
    await db.prepare('UPDATE freellm_weekly_quest_progress SET current_value = ?, completed = ? WHERE user_id = ? AND quest_id = ?').bind(newValue, completed, userId, quest.id).run()
  } else {
    await db.prepare('INSERT INTO freellm_weekly_quest_progress (user_id, quest_id, current_value, completed, created_at) VALUES (?, ?, ?, ?, ?)').bind(userId, quest.id, newValue, completed, now()).run()
  }
}

/**
 * Pays REFERRAL_REWARD to `referrerId` for each of their waiting referrals
 * whose referred user has hit the milestone (7-day tenure OR 200K tokens).
 * Returns the number paid.
 * 
 * Now supports double-sided milestone payouts:
 * - signup: 50k each (on verified signup)
 * - day1_checkin: 25k each (on first check-in)
 * - tenure_7: 200k each (on 7-day streak)
 * - tokens_200k: 225k each (on 200k Pool tokens)
 * Total per side: 500k
 */
export async function qualifyReferrals(db: D1Database, referrerId: string): Promise<number> {
  const waiting = await db
    .prepare(
      `SELECT r.id, r.referred_id, u.created_at, u.email_verified
       FROM freellm_referrals r JOIN freellm_users u ON u.id = r.referred_id
       WHERE r.referrer_id = ? AND r.status = 'waiting'`,
    )
    .bind(referrerId)
    .all<{ id: string; referred_id: string; created_at: number; email_verified: number }>()

  let paid = 0
  for (const row of waiting.results) {
    // Check each milestone and pay if not already paid
    const milestones = await checkAndPayReferralMilestones(db, row.id, row.referred_id, referrerId, row.created_at, row.email_verified === 1)
    paid += milestones
  }
  return paid
}

/**
 * Checks all milestones for a referral and pays any unpaid ones.
 * Returns number of milestones paid.
 */
async function checkAndPayReferralMilestones(
  db: D1Database,
  referralId: string,
  referredId: string,
  referrerId: string,
  referredCreatedAt: number,
  referredVerified: boolean
): Promise<number> {
  const timestamp = now()
  const tenureDays = (timestamp - referredCreatedAt) / 86_400_000
  
  const usage = await db
    .prepare(
      "SELECT COALESCE(SUM(total_tokens), 0) AS tokens FROM freellm_usage_events WHERE user_id = ? AND total_tokens IS NOT NULL AND status = 'completed' AND key_mode = 'pool'",
    )
    .bind(referredId)
    .first<{ tokens: number }>()
  const tokensUsed = usage?.tokens ?? 0

  // Check if referred user has checked in today (for day1_checkin milestone)
  const hasDay1Checkin = await db
    .prepare('SELECT 1 FROM freellm_checkins WHERE user_id = ? AND checkin_date = date(created_at / 1000, "unixepoch")')
    .bind(referredId)
    .first()

  let milestonesPaid = 0

  for (const milestone of REFERRAL_MILESTONES) {
    const milestoneId = `referral_milestone:${referralId}:${milestone.type}`
    
    // Check if this milestone was already paid
    const existing = await db
      .prepare('SELECT 1 FROM freellm_referral_milestones WHERE id = ?')
      .bind(milestoneId)
      .first()
    if (existing) continue

    // Check qualification criteria
    let qualifies = false
    switch (milestone.type) {
      case 'signup':
        qualifies = referredVerified
        break
      case 'day1_checkin':
        qualifies = !!hasDay1Checkin
        break
      case 'tenure_7':
        qualifies = tenureDays >= REFERRAL_TENURE_DAYS
        break
      case 'tokens_200k':
        qualifies = tokensUsed >= REFERRAL_TOKENS
        break
    }

    if (!qualifies) continue

    // Pay both sides for this milestone
    try {
      await db.batch([
        // Record milestone as paid
        db
          .prepare(
            `INSERT INTO freellm_referral_milestones (id, referral_id, milestone_type, referrer_reward, referred_reward, paid_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(milestoneId, referralId, milestone.type, milestone.referrer, milestone.referred, timestamp, timestamp),
        // Referrer reward
        db
          .prepare(
            `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
             VALUES (?, ?, ?, 'referral_reward', ?, ?)`,
          )
          .bind(
            `referral_reward:${referralId}:${milestone.type}:referrer`,
            referrerId,
            milestone.referrer,
            JSON.stringify({ referral_id: referralId, milestone: milestone.type, side: 'referrer' }),
            timestamp,
          ),
        db
          .prepare(
            `UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?`,
          )
          .bind(milestone.referrer, timestamp, referrerId),
        // Referred user reward
        db
          .prepare(
            `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
             VALUES (?, ?, ?, 'referral_reward', ?, ?)`,
          )
          .bind(
            `referral_reward:${referralId}:${milestone.type}:referred`,
            referredId,
            milestone.referred,
            JSON.stringify({ referral_id: referralId, milestone: milestone.type, side: 'referred' }),
            timestamp,
          ),
        db
          .prepare(
            `UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?`,
          )
          .bind(milestone.referred, timestamp, referredId),
      ])
      milestonesPaid++
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        // Already paid by concurrent request
        continue
      }
      throw err
    }
  }

  // If all milestones are paid, update referral status to 'paid'
  const totalMilestones = REFERRAL_MILESTONES.length
  const paidCount = await db
    .prepare('SELECT COUNT(*) AS n FROM freellm_referral_milestones WHERE referral_id = ?')
    .bind(referralId)
    .first<{ n: number }>()

  if (paidCount && paidCount.n >= totalMilestones) {
    await db
      .prepare("UPDATE freellm_referrals SET status = 'paid', qualified_at = ?, paid_at = ?, reward = ? WHERE id = ? AND status = 'waiting'")
      .bind(timestamp, timestamp, REFERRAL_REWARD, referralId)
      .run()
  }

  return milestonesPaid
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
  
  const checkedInYesterday = last && (await checkedInOn(c.env.DB, user.id, yesterday))
  let streak = checkedInYesterday ? last.streak + 1 : 1
  let usedFreeze = false

  // If streak would reset (missed a day), check for available freeze
  if (!checkedInYesterday && last) {
    const freeze = await c.env.DB.prepare(
      'SELECT id FROM freellm_streak_freezes WHERE user_id = ? AND used_at IS NULL ORDER BY earned_at ASC LIMIT 1'
    )
      .bind(user.id)
      .first<{ id: string }>()

    if (freeze) {
      // Consume the freeze
      const timestamp = now()
      await c.env.DB.batch([
        c.env.DB.prepare(
          'UPDATE freellm_streak_freezes SET used_at = ?, used_for_date = ? WHERE id = ?'
        ).bind(timestamp, today, freeze.id),
        c.env.DB.prepare(
          `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
           VALUES (?, ?, 0, 'streak_freeze_used', ?, ?)`
        ).bind(newId(), user.id, JSON.stringify({ freeze_id: freeze.id, saved_streak: last.streak }), timestamp),
      ])
      streak = last.streak + 1
      usedFreeze = true
    }
  }

  const milestone = CHECKIN_MILESTONES.find((m) => m.day === streak)
  const reward = CHECKIN_BASE_REWARD + (milestone?.bonus ?? 0)

  const timestamp = now()
  try {
    const batch = [
      c.env.DB.prepare(
        'INSERT INTO freellm_checkins (user_id, checkin_date, streak, reward, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(user.id, today, streak, reward, timestamp),
      c.env.DB.prepare(
        "INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at) VALUES (?, ?, ?, 'daily_checkin', ?, ?)",
      ).bind(
        newId(),
        user.id,
        reward,
        JSON.stringify({ streak, day_reward: CHECKIN_BASE_REWARD, milestone_bonus: milestone?.bonus ?? 0, freeze_used: usedFreeze }),
        timestamp,
      ),
      c.env.DB.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?').bind(
        reward,
        timestamp,
        user.id,
      ),
    ]

    // Grant streak freeze at day 30 milestone
    if (milestone && milestone.day === 30) {
      const freezeId = `streak_freeze:${user.id}:${timestamp}`
      batch.push(
        c.env.DB.prepare(
          `INSERT INTO freellm_streak_freezes (id, user_id, earned_at, earned_source, created_at)
           VALUES (?, ?, ?, 'day30_chest', ?)`
        ).bind(freezeId, user.id, timestamp, timestamp),
      )
    }

    await c.env.DB.batch(batch)
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

  // Update weekly quest progress for check-in streak
  await updateWeeklyQuestProgress(c.env.DB, user.id, 'checkin_streak', streak)

  // A day-1 check-in can push the referred user past the tenure milestone.
  await qualifyForReferredUser(c.env.DB, user.id)

  return c.json({
    already_checked_in: false,
    streak,
    reward,
    milestone: milestone ?? null,
    freeze_used: usedFreeze,
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

  // Get streak freezes
  const [checkin, referralRows, tasks, freezes] = await Promise.all([
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
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM freellm_streak_freezes WHERE user_id = ? AND used_at IS NULL').bind(user.id).first<{ n: number }>(),
  ])

  // Check if a freeze was used today
  const today = utcDate(now())
  const freezeUsedToday = await c.env.DB.prepare('SELECT 1 FROM freellm_streak_freezes WHERE user_id = ? AND used_at IS NOT NULL AND used_for_date = ?').bind(user.id, today).first()

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
    streak_freezes: freezes?.n ?? 0,
    freeze_used_today: !!freezeUsedToday,
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

// GET /api/referrals/friends-streaks — get streaks of referred users
app.get('/api/referrals/friends-streaks', requireAuth, async (c) => {
  const user = c.get('user')

  // Get user's own streak
  const ownStreak = await c.env.DB.prepare(
    'SELECT streak FROM freellm_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1'
  ).bind(user.id).first<{ streak: number }>()

  // Get referred users with their streak and referral status
  const rows = await c.env.DB.prepare(
    `SELECT
       u.id as user_id,
       u.username,
       u.avatar_url,
       r.status as referral_status,
       COALESCE((
         SELECT streak FROM freellm_checkins c
         WHERE c.user_id = u.id
         ORDER BY c.checkin_date DESC LIMIT 1
       ), 0) as streak,
       (
         SELECT checkin_date FROM freellm_checkins c
         WHERE c.user_id = u.id
         ORDER BY c.checkin_date DESC LIMIT 1
       ) as last_checkin
     FROM freellm_referrals r
     JOIN freellm_users u ON u.id = r.referred_id
     WHERE r.referrer_id = ?
     ORDER BY streak DESC`
  ).bind(user.id).all<{
    user_id: string
    username: string
    avatar_url: string | null
    referral_status: string
    streak: number
    last_checkin: string | null
  }>()

  return c.json({
    your_streak: ownStreak?.streak ?? 0,
    friends: rows.results,
  })
})

// =====================================================================
// Public referrer profile (for /r/:code landing page)
// =====================================================================

app.get('/api/referrers/:code/profile', async (c) => {
  const code = c.req.param('code')?.toLowerCase()
  if (!code) return c.json({ error: 'not_found', message: 'Invalid referral code.' }, 404)

  const referrer = await c.env.DB.prepare(
    'SELECT username, avatar_url FROM freellm_users WHERE LOWER(referral_code) = ?'
  )
    .bind(code)
    .first<{ username: string; avatar_url?: string }>()

  if (!referrer) return c.json({ error: 'not_found', message: 'Invalid referral code.' }, 404)

  const qualified = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM freellm_referrals WHERE referrer_id = (SELECT id FROM freellm_users WHERE LOWER(referral_code) = ?) AND status = 'paid'"
  )
    .bind(code)
    .first<{ n: number }>()

  return c.json({
    username: referrer.username,
    avatar_url: referrer.avatar_url ?? null,
    qualified_count: qualified?.n ?? 0,
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
// Weekly Quests
// =====================================================================

// GET /api/weekly-quests — current week's quests with user progress
app.get('/api/weekly-quests', requireAuth, async (c) => {
  const user = c.get('user')
  const { weekStart, weekEnd, weekKey } = weekBounds(now())

  await ensureWeeklyQuests(c.env.DB, weekStart, weekEnd, weekKey)

  const [quests, progress] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM freellm_weekly_quests WHERE week_start = ? ORDER BY created_at').bind(weekStart).all<{
      id: string; week_start: number; week_end: number; slug: string; title: string; description: string; target_value: number; reward: number; quest_type: string; active: number; created_at: number
    }>(),
    c.env.DB.prepare(
      `SELECT qp.quest_id, qp.current_value, qp.completed, qp.claimed_at
       FROM freellm_weekly_quest_progress qp
       JOIN freellm_weekly_quests q ON q.id = qp.quest_id
       WHERE qp.user_id = ? AND q.week_start = ?`
    ).bind(user.id, weekStart).all<{
      quest_id: string; current_value: number; completed: number; claimed_at: number | null
    }>(),
  ])

  const progressMap = new Map(progress.results.map((p) => [p.quest_id, p]))

  return c.json({
    week_start: weekStart,
    week_end: weekEnd,
    quests: quests.results.map((q) => {
      const p = progressMap.get(q.id)
      return {
        id: q.id,
        slug: q.slug,
        title: q.title,
        description: q.description,
        target: q.target_value,
        reward: q.reward,
        type: q.quest_type,
        current: p?.current_value ?? 0,
        completed: p?.completed ?? 0,
        claimed: !!p?.claimed_at,
        progress_pct: p ? Math.min(100, Math.round((p.current_value / q.target_value) * 100)) : 0,
      }
    }),
  })
})

// POST /api/weekly-quests/:id/claim — claim reward for completed quest
app.post('/api/weekly-quests/:id/claim', requireAuth, async (c) => {
  const user = c.get('user')
  const gate = requireVerified(user)
  if (gate) return gate

  const questId = c.req.param('id')
  const quest = await c.env.DB.prepare('SELECT * FROM freellm_weekly_quests WHERE id = ?').bind(questId).first<{
    id: string; reward: number; slug: string
  }>()
  if (!quest) return c.json({ error: 'not_found', message: 'Quest not found.' }, 404)

  const progress = await c.env.DB.prepare('SELECT * FROM freellm_weekly_quest_progress WHERE user_id = ? AND quest_id = ?').bind(user.id, questId).first()
  if (!progress || !progress.completed || progress.claimed_at) {
    return c.json({ error: 'not_completed', message: 'Quest not completed or already claimed.' }, 409)
  }

  const timestamp = now()
  try {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE freellm_weekly_quest_progress SET claimed_at = ? WHERE user_id = ? AND quest_id = ?').bind(timestamp, user.id, questId),
      c.env.DB.prepare(
        `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
         VALUES (?, ?, ?, 'weekly_quest', ?, ?)`
      ).bind(newId(), user.id, quest.reward, JSON.stringify({ quest_id: questId, slug: quest.slug }), timestamp),
      c.env.DB.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?').bind(quest.reward, timestamp, user.id),
    ])
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'already_claimed', message: 'Already claimed.' }, 409)
    }
    throw err
  }

  return c.json({ ok: true, reward: quest.reward, balance: user.balance_credits + quest.reward })
})

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
// Usage Export (CSV/JSON)
// =====================================================================

app.get('/api/usage/export', requireAuth, async (c) => {
  const user = c.get('user')
  const format = c.req.query('format') || 'csv'  // csv or json
  const days = parseInt(c.req.query('days') || '365', 10)  // default 1 year

  const since = now() - days * 86_400_000

  const [events, perModel, daily] = await Promise.all([
    c.env.DB.prepare(
      'SELECT model, source, status, input_tokens, output_tokens, total_tokens, credits_charged, latency_ms, created_at, key_mode' +
      ' FROM freellm_usage_events WHERE user_id = ? AND status != \'failed\' AND created_at > ?' +
      ' ORDER BY created_at DESC',
    )
      .bind(user.id, since)
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
        key_mode: string
      }>(),
    c.env.DB.prepare(
      'SELECT model,' +
      ' COUNT(*) AS messages,' +
      ' SUM(credits_charged) AS credits,' +
      ' SUM(total_tokens) AS tokens,' +
      ' SUM(input_tokens) AS input_tokens,' +
      ' SUM(output_tokens) AS output_tokens,' +
      ' SUM(CASE WHEN source = \'flat_rate\' THEN 1 ELSE 0 END) AS flat_rate_messages' +
      ' FROM freellm_usage_events WHERE user_id = ? AND status != \'failed\' AND created_at > ?' +
      ' GROUP BY model ORDER BY credits DESC',
    )
      .bind(user.id, since)
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
      'SELECT date(created_at / 1000, \'unixepoch\') AS day, SUM(credits_charged) AS credits, COUNT(*) AS messages' +
      ' FROM freellm_usage_events WHERE user_id = ? AND status != \'failed\' AND created_at > ?' +
      ' GROUP BY day ORDER BY day',
    )
      .bind(user.id, since)
      .all<{ day: string; credits: number; messages: number }>(),
  ])

  const data = {
    exported_at: new Date().toISOString(),
    user_id: user.id,
    username: user.username,
    period_days: days,
    events: events.results,
    per_model: perModel.results,
    daily: daily.results,
  }

  if (format === 'json') {
    return c.json(data)
  }

  // CSV format - flatten events
  const headers = [
    'date', 'model', 'source', 'status', 'key_mode',
    'input_tokens', 'output_tokens', 'total_tokens', 'credits_charged', 'latency_ms'
  ]
  const rows = events.results.map(e => [
    new Date(e.created_at).toISOString(),
    e.model,
    e.source,
    e.status,
    e.key_mode,
    e.input_tokens ?? '',
    e.output_tokens ?? '',
    e.total_tokens ?? '',
    e.credits_charged,
    e.latency_ms ?? '',
  ])
  const csv = [headers.join(',')].concat(rows.map(r => r.map(v => typeof v === 'string' && v.includes(',') ? '\"' + v + '\"' : v).join(','))).join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename=\"freellm-usage-' + new Date().toISOString().split('T')[0] + '.csv\"'
    }
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

// =====================================================================
// Leaderboards
// =====================================================================

// GET /api/leaderboards/typing — weekly typing WPM leaderboard
app.get('/api/leaderboards/typing', async (c) => {
  const { weekStart } = weekBounds(now())
  const rows = await c.env.DB.prepare(
    'SELECT user_id, username, avatar_url, best_wpm, achieved_at FROM freellm_leaderboard_typing WHERE week_start = ? ORDER BY best_wpm DESC LIMIT 50'
  ).bind(weekStart).all()
  return c.json({ week_start: weekStart, entries: rows.results })
})

// GET /api/leaderboards/memory — weekly memory moves leaderboard
app.get('/api/leaderboards/memory', async (c) => {
  const { weekStart } = weekBounds(now())
  const rows = await c.env.DB.prepare(
    'SELECT user_id, username, avatar_url, best_moves, achieved_at FROM freellm_leaderboard_memory WHERE week_start = ? ORDER BY best_moves ASC LIMIT 50'
  ).bind(weekStart).all()
  return c.json({ week_start: weekStart, entries: rows.results })
})

// GET /api/leaderboards/streak — current streak leaderboard
app.get('/api/leaderboards/streak', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT user_id, username, avatar_url, streak FROM freellm_leaderboard_streak ORDER BY streak DESC LIMIT 50'
  ).all()
  return c.json({ entries: rows.results })
})

// GET /api/leaderboards/referrals — lifetime referral leaderboard
app.get('/api/leaderboards/referrals', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT user_id, username, avatar_url, qualified_count FROM freellm_leaderboard_referrals ORDER BY qualified_count DESC LIMIT 50'
  ).all()
  return c.json({ entries: rows.results })
})

// POST /api/leaderboards/refresh — admin endpoint to refresh all leaderboards
app.post('/api/leaderboards/refresh', requireAuth, async (c) => {
  const user = c.get('user')
  if (user.role !== 'admin') return c.json({ error: 'forbidden', message: 'Admin only.' }, 403)

  const timestamp = now()
  const { weekStart } = weekBounds(timestamp)

  // Refresh typing leaderboard (best WPM this week)
  await c.env.DB.exec(`
    DELETE FROM freellm_leaderboard_typing WHERE week_start = ${weekStart};
    INSERT INTO freellm_leaderboard_typing (user_id, username, avatar_url, best_wpm, achieved_at, week_start, created_at)
    SELECT
      gr.user_id,
      u.username,
      u.avatar_url,
      MAX(CAST(SUBSTR(l.meta, INSTR(l.meta, 'wpm:') + 4) AS INTEGER)) as best_wpm,
      MAX(l.created_at) as achieved_at,
      ${weekStart} as week_start,
      ${timestamp} as created_at
    FROM freellm_credit_ledger l
    JOIN freellm_game_rounds gr ON gr.id = SUBSTR(l.meta, INSTR(l.meta, 'round_id:') + 9, 36)
    JOIN freellm_users u ON u.id = gr.user_id
    WHERE l.reason = 'game_reward'
      AND l.meta LIKE '%"game":"typing"%'
      AND l.created_at >= ${weekStart}
      AND l.created_at < ${weekStart + 7 * 86400000}
    GROUP BY gr.user_id, u.username, u.avatar_url
    HAVING best_wpm > 0
  `)

  // Refresh memory leaderboard (fewest moves this week)
  await c.env.DB.exec(`
    DELETE FROM freellm_leaderboard_memory WHERE week_start = ${weekStart};
    INSERT INTO freellm_leaderboard_memory (user_id, username, avatar_url, best_moves, achieved_at, week_start, created_at)
    SELECT
      gr.user_id,
      u.username,
      u.avatar_url,
      MIN(CAST(SUBSTR(l.meta, INSTR(l.meta, 'moves:') + 6) AS INTEGER)) as best_moves,
      MIN(l.created_at) as achieved_at,
      ${weekStart} as week_start,
      ${timestamp} as created_at
    FROM freellm_credit_ledger l
    JOIN freellm_game_rounds gr ON gr.id = SUBSTR(l.meta, INSTR(l.meta, 'round_id:') + 9, 36)
    JOIN freellm_users u ON u.id = gr.user_id
    WHERE l.reason = 'game_reward'
      AND l.meta LIKE '%"game":"memory"%'
      AND l.created_at >= ${weekStart}
      AND l.created_at < ${weekStart + 7 * 86400000}
    GROUP BY gr.user_id, u.username, u.avatar_url
    HAVING best_moves > 0
  `)

  // Refresh streak leaderboard (current streak)
  await c.env.DB.exec(`
    DELETE FROM freellm_leaderboard_streak;
    INSERT INTO freellm_leaderboard_streak (user_id, username, avatar_url, streak, updated_at)
    SELECT
      u.id,
      u.username,
      u.avatar_url,
      COALESCE((
        SELECT streak FROM freellm_checkins c
        WHERE c.user_id = u.id
        ORDER BY c.checkin_date DESC LIMIT 1
      ), 0) as streak,
      ${timestamp} as updated_at
    FROM freellm_users u
    WHERE u.email_verified = 1
  `)

  // Refresh referral leaderboard (lifetime qualified)
  await c.env.DB.exec(`
    DELETE FROM freellm_leaderboard_referrals;
    INSERT INTO freellm_leaderboard_referrals (user_id, username, avatar_url, qualified_count, updated_at)
    SELECT
      r.referrer_id,
      u.username,
      u.avatar_url,
      COUNT(*) as qualified_count,
      ${timestamp} as updated_at
    FROM freellm_referrals r
    JOIN freellm_users u ON u.id = r.referrer_id
    WHERE r.status = 'paid'
    GROUP BY r.referrer_id, u.username, u.avatar_url
  `)

  // Update metadata
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR REPLACE INTO freellm_leaderboard_meta (leaderboard_id, last_refresh) VALUES (?, ?)').bind('typing', timestamp),
    c.env.DB.prepare('INSERT OR REPLACE INTO freellm_leaderboard_meta (leaderboard_id, last_refresh) VALUES (?, ?)').bind('memory', timestamp),
    c.env.DB.prepare('INSERT OR REPLACE INTO freellm_leaderboard_meta (leaderboard_id, last_refresh) VALUES (?, ?)').bind('streak', timestamp),
    c.env.DB.prepare('INSERT OR REPLACE INTO freellm_leaderboard_meta (leaderboard_id, last_refresh) VALUES (?, ?)').bind('referrals', timestamp),
  ])

  return c.json({ ok: true, refreshed_at: timestamp })
})

// =====================================================================
// Badges
// =====================================================================

// GET /api/badges — all badge definitions with user's earned status
app.get('/api/badges', requireAuth, async (c) => {
  const user = c.get('user')

  const [badges, userBadges] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM freellm_badges ORDER BY category, tier').all(),
    c.env.DB.prepare('SELECT badge_id, earned_at, notified FROM freellm_user_badges WHERE user_id = ?').bind(user.id).all(),
  ])

  const earnedMap = new Map(userBadges.results.map((b) => [b.badge_id, b]))

  return c.json({
    badges: badges.results.map((b) => {
      const earned = earnedMap.get(b.id)
      return {
        ...b,
        earned: !!earned,
        earned_at: earned?.earned_at ?? null,
        notified: earned?.notified ?? 0,
      }
    }),
  })
})

// POST /api/badges/check — check and award any newly earned badges
app.post('/api/badges/check', requireAuth, async (c) => {
  const user = c.get('user')
  const timestamp = now()
  const newlyEarned: string[] = []

  // Get all badge definitions
  const badges = await c.env.DB.prepare('SELECT * FROM freellm_badges').all<{
    id: string; name: string; description: string; icon: string; category: string; tier: number; reward: number; created_at: number
  }>()
  const userBadges = await c.env.DB.prepare('SELECT badge_id FROM freellm_user_badges WHERE user_id = ?').bind(user.id).all()
  const earnedSet = new Set(userBadges.results.map((b) => b.badge_id))

  // Check each badge criteria
  for (const badge of badges.results) {
    if (earnedSet.has(badge.id)) continue

    let qualifies = false

    switch (badge.id) {
      case 'streak_7': {
        const streak = await c.env.DB.prepare(
          'SELECT streak FROM freellm_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1'
        ).bind(user.id).first<{ streak: number }>()
        qualifies = (streak?.streak ?? 0) >= 7
        break
      }
      case 'streak_30': {
        const streak = await c.env.DB.prepare(
          'SELECT streak FROM freellm_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1'
        ).bind(user.id).first<{ streak: number }>()
        qualifies = (streak?.streak ?? 0) >= 30
        break
      }
      case 'typing_80wpm': {
        const best = await c.env.DB.prepare(
          `SELECT MAX(CAST(SUBSTR(meta, INSTR(meta, 'wpm:') + 4) AS INTEGER)) as wpm
           FROM freellm_credit_ledger
           WHERE user_id = ? AND reason = 'game_reward' AND meta LIKE '%"game":"typing"%'`
        ).bind(user.id).first<{ wpm: number }>()
        qualifies = (best?.wpm ?? 0) >= 80
        break
      }
      case 'typing_100wpm': {
        const best = await c.env.DB.prepare(
          `SELECT MAX(CAST(SUBSTR(meta, INSTR(meta, 'wpm:') + 4) AS INTEGER)) as wpm
           FROM freellm_credit_ledger
           WHERE user_id = ? AND reason = 'game_reward' AND meta LIKE '%"game":"typing"%'`
        ).bind(user.id).first<{ wpm: number }>()
        qualifies = (best?.wpm ?? 0) >= 100
        break
      }
      case 'memory_perfect': {
        const best = await c.env.DB.prepare(
          `SELECT MIN(CAST(SUBSTR(meta, INSTR(meta, 'moves:') + 6) AS INTEGER)) as moves
           FROM freellm_credit_ledger
           WHERE user_id = ? AND reason = 'game_reward' AND meta LIKE '%"game":"memory"%'`
        ).bind(user.id).first<{ moves: number }>()
        qualifies = (best?.moves ?? 999) <= 6
        break
      }
      case 'memory_speed': {
        // Check for memory game completed in under 30 seconds
        const fast = await c.env.DB.prepare(
          `SELECT 1 FROM freellm_game_rounds
           WHERE user_id = ? AND game = 'memory' AND claimed_at IS NOT NULL
           AND (claimed_at - created_at) < 30000`
        ).bind(user.id).first()
        qualifies = !!fast
        break
      }
      case 'referral_1':
      case 'referral_5':
      case 'referral_10': {
        const threshold = badge.id === 'referral_1' ? 1 : badge.id === 'referral_5' ? 5 : 10
        const count = await c.env.DB.prepare(
          "SELECT COUNT(*) as n FROM freellm_referrals WHERE referrer_id = ? AND status = 'paid'"
        ).bind(user.id).first<{ n: number }>()
        qualifies = (count?.n ?? 0) >= threshold
        break
      }
      case 'pool_100k': {
        const usage = await c.env.DB.prepare(
          "SELECT COALESCE(SUM(total_tokens), 0) as tokens FROM freellm_usage_events WHERE user_id = ? AND status = 'completed' AND key_mode = 'pool'"
        ).bind(user.id).first<{ tokens: number }>()
        qualifies = (usage?.tokens ?? 0) >= 100_000
        break
      }
      case 'pool_1m': {
        const usage = await c.env.DB.prepare(
          "SELECT COALESCE(SUM(total_tokens), 0) as tokens FROM freellm_usage_events WHERE user_id = ? AND status = 'completed' AND key_mode = 'pool'"
        ).bind(user.id).first<{ tokens: number }>()
        qualifies = (usage?.tokens ?? 0) >= 1_000_000
        break
      }
      case 'daily_clear': {
        const clears = await c.env.DB.prepare(
          `SELECT COUNT(*) as n FROM freellm_game_rounds
           WHERE user_id = ? AND game = 'clear' AND claimed_at IS NOT NULL`
        ).bind(user.id).first<{ n: number }>()
        qualifies = (clears?.n ?? 0) >= 10
        break
      }
    }

    if (qualifies) {
      const badgeId = `user_badge:${user.id}:${badge.id}`
      try {
        await c.env.DB.batch([
          c.env.DB.prepare('INSERT INTO freellm_user_badges (user_id, badge_id, earned_at, notified) VALUES (?, ?, ?, 0)')
            .bind(user.id, badge.id, timestamp),
          c.env.DB.prepare(
            `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
             VALUES (?, ?, ?, 'badge_reward', ?, ?)`
          ).bind(badgeId, user.id, badge.reward, JSON.stringify({ badge_id: badge.id }), timestamp),
          c.env.DB.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?')
            .bind(badge.reward, timestamp, user.id),
        ])
        newlyEarned.push(badge.id)
      } catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
          // Already earned, skip
        } else {
          throw err
        }
      }
    }
  }

  return c.json({ newly_earned: newlyEarned })
})

// POST /api/badges/:id/notify — mark badge notification as seen
app.post('/api/badges/:id/notify', requireAuth, async (c) => {
  const user = c.get('user')
  const badgeId = c.req.param('id')

  await c.env.DB.prepare('UPDATE freellm_user_badges SET notified = 1 WHERE user_id = ? AND badge_id = ?')
    .bind(user.id, badgeId)
    .run()

  return c.json({ ok: true })
})

// =====================================================================
// Seasonal Events
// =====================================================================

// GET /api/seasonal-events — current active events
app.get('/api/seasonal-events', async (c) => {
  const now_ = now()
  const events = await c.env.DB.prepare(
    `SELECT id, name, description, icon, banner_color, start_at, end_at, config_json
     FROM freellm_seasonal_events
     WHERE active = 1 AND start_at <= ? AND end_at > ?
     ORDER BY start_at`
  ).bind(now_, now_).all<{
    id: string; name: string; description: string; icon: string; banner_color: string; start_at: number; end_at: number; config_json: string
  }>()

  return c.json({
    events: events.results.map((e) => ({
      ...e,
      config: JSON.parse(e.config_json),
    })),
  })
})

// GET /api/seasonal-events/:id — event details with user progress
app.get('/api/seasonal-events/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const eventId = c.req.param('id')

  const event = await c.env.DB.prepare(
    'SELECT * FROM freellm_seasonal_events WHERE id = ?'
  ).bind(eventId).first<{
    id: string; name: string; description: string; icon: string; banner_color: string; start_at: number; end_at: number; config_json: string; active: number; created_at: number
  }>()
  if (!event) return c.json({ error: 'not_found', message: 'Event not found.' }, 404)

  const participation = await c.env.DB.prepare(
    'SELECT progress_json, rewards_claimed_json, joined_at FROM freellm_user_seasonal_events WHERE user_id = ? AND event_id = ?'
  ).bind(user.id, eventId).first<{ progress_json: string; rewards_claimed_json: string; joined_at: number }>()

  const cosmetics = await c.env.DB.prepare(
    'SELECT * FROM freellm_seasonal_cosmetics WHERE event_id = ?'
  ).bind(eventId).all<{
    id: string; event_id: string; type: string; name: string; description: string; icon: string; unlock_criteria_json: string; created_at: number
  }>()

  const userCosmetics = await c.env.DB.prepare(
    'SELECT cosmetic_id, equipped FROM freellm_user_cosmetics WHERE user_id = ?'
  ).bind(user.id).all()
  const equippedSet = new Set(userCosmetics.results.filter(c => c.equipped).map(c => c.cosmetic_id))
  const unlockedSet = new Set(userCosmetics.results.map(c => c.cosmetic_id))

  return c.json({
    event: {
      ...event,
      config: JSON.parse(event.config_json),
      cosmetics: cosmetics.results.map((c) => ({
        ...c,
        unlock_criteria: JSON.parse(c.unlock_criteria_json),
        unlocked: unlockedSet.has(c.id),
        equipped: equippedSet.has(c.id),
      })),
    },
    participation: participation ? {
      progress: JSON.parse(participation.progress_json),
      rewards_claimed: JSON.parse(participation.rewards_claimed_json),
      joined_at: participation.joined_at,
    } : null,
  })
})

// POST /api/seasonal-events/:id/join — join an event
app.post('/api/seasonal-events/:id/join', requireAuth, async (c) => {
  const user = c.get('user')
  const eventId = c.req.param('id')
  const timestamp = now()

  const event = await c.env.DB.prepare('SELECT * FROM freellm_seasonal_events WHERE id = ? AND active = 1 AND start_at <= ? AND end_at > ?')
    .bind(eventId, timestamp, timestamp)
    .first()
  if (!event) return c.json({ error: 'not_found', message: 'Event not found or not active.' }, 404)

  const existing = await c.env.DB.prepare('SELECT 1 FROM freellm_user_seasonal_events WHERE user_id = ? AND event_id = ?')
    .bind(user.id, eventId)
    .first()
  if (existing) return c.json({ ok: true, already_joined: true })

  await c.env.DB.prepare(
    'INSERT INTO freellm_user_seasonal_events (user_id, event_id, progress_json, rewards_claimed_json, joined_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(user.id, eventId, '{}', '[]', timestamp).run()

  return c.json({ ok: true, joined_at: timestamp })
})

// POST /api/seasonal-events/:id/quest/:questId/progress — update quest progress
app.post('/api/seasonal-events/:id/quest/:questId/progress', requireAuth, async (c) => {
  const user = c.get('user')
  const eventId = c.req.param('id')
  const questId = c.req.param('questId')
  const body = await c.req.json<{ value: number }>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_input', message: 'value is required.' }, 400)

  const participation = await c.env.DB.prepare('SELECT progress_json FROM freellm_user_seasonal_events WHERE user_id = ? AND event_id = ?')
    .bind(user.id, eventId)
    .first<{ progress_json: string }>()
  if (!participation) return c.json({ error: 'not_joined', message: 'Join the event first.' }, 409)

  const progress = JSON.parse(participation.progress_json)
  progress[questId] = Math.max(progress[questId] ?? 0, body.value)

  await c.env.DB.prepare('UPDATE freellm_user_seasonal_events SET progress_json = ? WHERE user_id = ? AND event_id = ?')
    .bind(JSON.stringify(progress), user.id, eventId)
    .run()

  return c.json({ ok: true, progress })
})

// POST /api/seasonal-events/:id/quest/:questId/claim — claim quest reward
app.post('/api/seasonal-events/:id/quest/:questId/claim', requireAuth, async (c) => {
  const user = c.get('user')
  const eventId = c.req.param('id')
  const questId = c.req.param('questId')
  const timestamp = now()

  const event = await c.env.DB.prepare('SELECT config_json FROM freellm_seasonal_events WHERE id = ?').bind(eventId).first<{ config_json: string }>()
  if (!event) return c.json({ error: 'not_found', message: 'Event not found.' }, 404)

  const config = JSON.parse(event.config_json)
  const quest = config.quests?.find((q: any) => q.id === questId)
  if (!quest) return c.json({ error: 'not_found', message: 'Quest not found.' }, 404)

  const participation = await c.env.DB.prepare('SELECT progress_json, rewards_claimed_json FROM freellm_user_seasonal_events WHERE user_id = ? AND event_id = ?')
    .bind(user.id, eventId)
    .first<{ progress_json: string; rewards_claimed_json: string }>()
  if (!participation) return c.json({ error: 'not_joined', message: 'Join the event first.' }, 409)

  const progress = JSON.parse(participation.progress_json)
  const claimed = JSON.parse(participation.rewards_claimed_json)

  if (claimed.includes(questId)) return c.json({ error: 'already_claimed', message: 'Already claimed.' }, 409)
  if ((progress[questId] ?? 0) < quest.target) return c.json({ error: 'not_completed', message: 'Quest not completed.' }, 409)

  claimed.push(questId)
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE freellm_user_seasonal_events SET rewards_claimed_json = ? WHERE user_id = ? AND event_id = ?')
      .bind(JSON.stringify(claimed), user.id, eventId),
    c.env.DB.prepare(
      `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
       VALUES (?, ?, ?, 'seasonal_event', ?, ?)`
    ).bind(newId(), user.id, quest.reward, JSON.stringify({ event_id: eventId, quest_id: questId }), timestamp),
    c.env.DB.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?')
      .bind(quest.reward, timestamp, user.id),
  ])

  return c.json({ ok: true, reward: quest.reward })
})

// POST /api/cosmetics/:id/equip — equip/unequip a cosmetic
app.post('/api/cosmetics/:id/equip', requireAuth, async (c) => {
  const user = c.get('user')
  const cosmeticId = c.req.param('id')
  const body = await c.req.json<{ equip: boolean }>().catch(() => ({ equip: true }))

  const cosmetic = await c.env.DB.prepare('SELECT * FROM freellm_seasonal_cosmetics WHERE id = ?').bind(cosmeticId).first()
  if (!cosmetic) return c.json({ error: 'not_found', message: 'Cosmetic not found.' }, 404)

  const userCosmetic = await c.env.DB.prepare('SELECT equipped FROM freellm_user_cosmetics WHERE user_id = ? AND cosmetic_id = ?')
    .bind(user.id, cosmeticId)
    .first<{ equipped: number }>()
  if (!userCosmetic) return c.json({ error: 'not_unlocked', message: 'Cosmetic not unlocked.' }, 409)

  if (body.equip) {
    // Unequip other cosmetics of same type
    await c.env.DB.prepare(
      `UPDATE freellm_user_cosmetics SET equipped = 0
       WHERE user_id = ? AND cosmetic_id IN (SELECT id FROM freellm_seasonal_cosmetics WHERE type = ?)`
    ).bind(user.id, cosmetic.type).run()
  }

  await c.env.DB.prepare('UPDATE freellm_user_cosmetics SET equipped = ? WHERE user_id = ? AND cosmetic_id = ?')
    .bind(body.equip ? 1 : 0, user.id, cosmeticId)
    .run()

  return c.json({ ok: true, equipped: body.equip })
})

export default app
