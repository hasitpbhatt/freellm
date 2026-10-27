// Promo codes.
//
// Admin (behind requireAuth + requireAdmin):
//   GET    /api/admin/promos                 list + redemption stats
//   POST   /api/admin/promos                 create
//   PATCH  /api/admin/promos/:id             update (incl. activate/deactivate)
//   DELETE /api/admin/promos/:id
//   GET    /api/admin/promos/:id/redemptions audit trail
//
// Consumers (behind requireAuth):
//   POST /api/promos/redeem   { code } — atomic grant + limit checks
//   GET  /api/promos/mine     redemption history
//   GET  /api/balance         global + per-model credit balances

import { Hono } from 'hono'
import { requireAdmin, requireAuth } from '../lib/middleware'
import { newId } from '../lib/crypto'
import { slugify } from '../lib/validate'
import { expireAdminGrants } from '../lib/credit-grants'
import { expirePromoCredits } from '../lib/promo-expiry'
import type { Bindings, ModelRow, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const now = () => Date.now()
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$/

/** Normalizes user input to the canonical stored form: LAUNCH2026 -> LAUNCH-2026 style. */
export function normalizePromoCode(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const code = input.trim().toUpperCase().replace(/\s+/g, '-')
  return CODE_RE.test(code) ? code : null
}

// =====================================================================
// Consumer endpoints
// =====================================================================

app.use('/api/promos/*', requireAuth)
app.use('/api/balance', requireAuth)

// ------------------------------------------------------------ balance

app.get('/api/balance', async (c) => {
  const user = c.get('user')
  // Lazy expiry sweeps so the displayed balance reflects any expired grants.
  // Best-effort — a race just defers to the next sweep.
  await expirePromoCredits(c.env.DB, user.id).catch(() => {})
  await expireAdminGrants(c.env.DB, user.id).catch(() => {})
  const freshUser = await c.env.DB.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?')
    .bind(user.id)
    .first<{ balance_credits: number }>()
  const globalBalance = freshUser?.balance_credits ?? user.balance_credits
  const grants = await c.env.DB.prepare(
    `SELECT g.credits, m.id AS model_id, m.slug, m.label
     FROM freellm_model_credit_grants g JOIN freellm_models m ON m.id = g.model_id
     WHERE g.user_id = ? AND g.credits > 0
     ORDER BY g.credits DESC`,
  )
    .bind(user.id)
    .all<{ credits: number; model_id: string; slug: string; label: string }>()

  const totalByModel = grants.results.reduce((sum, g) => sum + g.credits, 0)
  return c.json({
    global: globalBalance,
    by_model: grants.results.map((g) => ({
      model_id: g.model_id,
      slug: g.slug,
      label: g.label,
      credits: g.credits,
    })),
    total: globalBalance + totalByModel,
  })
})

// ------------------------------------------------------------- redeem

/**
 * The redemption grant as one ordered statement list. Statement 0 is the
 * atomic gate: the redemption row INSERT itself checks the redemption
 * ceiling AND the per-user limit inline, so the row only lands when both
 * are satisfied. Every later statement is conditioned on that row existing
 * in this transaction, so a lost slot or a limited retry pays nothing, and
 * the whole list is a single transaction.
 *
 * Why the INSERT (not a pre-increment counter) is the gate: the old shape
 * reserved a slot by bumping `redemption_count` and then guarded the INSERT
 * with `redemption_count = <stale snapshot + 1>`. Two DIFFERENT users racing
 * a one-shot code both snapshot count=0, so user B's INSERT saw count=1
 * (bumped by A) equal its own stale snapshot and minted too. Making the
 * INSERT the gate means the second user's INSERT sees the first's committed
 * count and is refused by the ceiling. Exported for the race tests.
 */
export function promoRedemptionStatements(
  db: D1Database,
  params: {
    promo: {
      id: string
      code: string
      credits: number
      model_id: string | null
      redemption_count: number
      per_user_limit: number
      expires_at: number | null
    }
    user: { id: string }
    redemptionId: string
    ledgerId: string
    timestamp: number
  },
) {
  const { promo, user, redemptionId, ledgerId, timestamp } = params

  const statements = [
    // The atomic gate: insert the redemption row only while the code is
    // under its ceiling AND this user is under their per-user limit. The
    // UNIQUE(promo_code_id, user_id) index is the final word on same-user
    // races; the inline ceiling check is what stops two different users
    // from both minting a one-shot code. `expires_at` is snapshotted so the
    // granted credits can expire even if the code's own expiry is edited.
    db
      .prepare(
        `INSERT INTO freellm_promo_redemptions (id, promo_code_id, user_id, credits, model_id, created_at, expires_at)
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM freellm_promo_codes
                        WHERE id = ? AND (max_redemptions IS NULL OR redemption_count < max_redemptions))
           AND (SELECT COUNT(*) FROM freellm_promo_redemptions
                 WHERE promo_code_id = ? AND user_id = ?) < ?`,
      )
      .bind(
        redemptionId,
        promo.id,
        user.id,
        promo.credits,
        promo.model_id,
        timestamp,
        promo.expires_at,
        promo.id,
        promo.id,
        user.id,
        promo.per_user_limit,
      ),
    // Bump the denormalized counter, only when the row above landed.
    db
      .prepare(
        `UPDATE freellm_promo_codes SET redemption_count = redemption_count + 1, updated_at = ?
         WHERE id = ? AND EXISTS (SELECT 1 FROM freellm_promo_redemptions WHERE id = ?)`,
      )
      .bind(timestamp, promo.id, redemptionId),
    // Ledger, then the actual credit — both only when the redemption row
    // exists in this transaction.
    db
      .prepare(
        `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
         SELECT ?, ?, ?, 'promo_code', ?, ?
         WHERE EXISTS (SELECT 1 FROM freellm_promo_redemptions WHERE id = ?)`,
      )
      .bind(
        ledgerId,
        user.id,
        promo.credits,
        JSON.stringify({ promo_code: promo.code, redemption_id: redemptionId, model_id: promo.model_id }),
        timestamp,
        redemptionId,
      ),
  ]

  if (promo.model_id) {
    // Model-scoped: upsert the per-model grant balance.
    statements.push(
      db
        .prepare(
          `INSERT INTO freellm_model_credit_grants (id, user_id, model_id, credits, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM freellm_promo_redemptions WHERE id = ?)
           ON CONFLICT (user_id, model_id) DO UPDATE SET credits = credits + excluded.credits, updated_at = excluded.updated_at`,
        )
        .bind(newId(), user.id, promo.model_id, promo.credits, timestamp, timestamp, redemptionId),
    )
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ?
           WHERE id = ? AND EXISTS (SELECT 1 FROM freellm_promo_redemptions WHERE id = ?)`,
        )
        .bind(promo.credits, timestamp, user.id, redemptionId),
    )
  }
  return statements
}

app.post('/api/promos/redeem', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ code?: unknown }>().catch(() => null)
  const code = normalizePromoCode(body?.code)
  if (!code) {
    return c.json({ error: 'invalid_code', message: 'Enter a valid promo code.' }, 400)
  }

  // ---- checks (SELECTs) ------------------------------------------------
  const promo = await c.env.DB.prepare('SELECT * FROM freellm_promo_codes WHERE code = ?').bind(code).first<{
    id: string
    code: string
    credits: number
    model_id: string | null
    max_redemptions: number | null
    redemption_count: number
    per_user_limit: number
    min_account_age_hours: number
    starts_at: number | null
    expires_at: number | null
    active: number
  }>()
  if (!promo || promo.active !== 1) {
    return c.json({ error: 'invalid_code', message: 'That promo code is not valid.' }, 404)
  }

  const timestamp = now()
  if (promo.starts_at && timestamp < promo.starts_at) {
    return c.json({ error: 'not_started', message: 'That promo code is not active yet.' }, 409)
  }
  if (promo.expires_at && timestamp > promo.expires_at) {
    return c.json({ error: 'expired', message: 'That promo code has expired.' }, 410)
  }
  if (promo.max_redemptions !== null && promo.redemption_count >= promo.max_redemptions) {
    return c.json({ error: 'sold_out', message: 'That promo code has been fully redeemed.' }, 409)
  }

  const accountAgeHours = (timestamp - user.created_at) / 3_600_000
  if (accountAgeHours < promo.min_account_age_hours) {
    const hoursLeft = Math.ceil(promo.min_account_age_hours - accountAgeHours)
    return c.json(
      { error: 'account_too_new', message: `This code needs an account at least ${promo.min_account_age_hours}h old — try again in ${hoursLeft}h.` },
      409,
    )
  }

  const usedCount = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM freellm_promo_redemptions WHERE promo_code_id = ? AND user_id = ?',
  )
    .bind(promo.id, user.id)
    .first<{ n: number }>()
  if ((usedCount?.n ?? 0) >= promo.per_user_limit) {
    return c.json({ error: 'already_redeemed', message: 'You have already redeemed this code.' }, 409)
  }

  // ---- grant (one atomic batch) ---------------------------------------
  // The old shape checked the guarded UPDATE's `changes` AFTER the batch,
  // which committed the ledger insert and balance bump anyway — so an
  // exhausted code could be "redeemed" repeatedly, each time returning
  // 409 sold_out while still minting credits. Now the redemption INSERT is
  // statement zero and EVERY later statement is conditioned on it, so a
  // lost slot pays nothing; the batch is the transaction, so a crash pays
  // all or nothing. The UNIQUE(promo_code_id, user_id) index (migration
  // 0022) is the hard per-user guarantee for the common limit-1 case, and
  // the INSERT's inline ceiling check stops two different users from both
  // minting a one-shot code.
  const redemptionId = newId()
  const ledgerId = newId()
  const statements = promoRedemptionStatements(c.env.DB, {
    promo,
    user,
    redemptionId,
    ledgerId,
    timestamp,
  })

  let batchResult: Array<{ success: boolean; meta?: { changes?: number } }>
  try {
    batchResult = (await c.env.DB.batch(statements)) as unknown as Array<{ success: boolean; meta?: { changes?: number } }>
  } catch (err) {
    // Lost the per-user race — the UNIQUE index rejected the redemption row.
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_promo_redemptions')) {
      return c.json({ error: 'already_redeemed', message: 'You have already redeemed this code.' }, 409)
    }
    throw err
  }
  const reserved = batchResult[0]
  if (!reserved?.success || reserved.meta?.changes === 0) {
    // The redemption row didn't land — either a lost race for the last slot
    // or this user is at their limit. One extra read tells us which, so the
    // message is honest.
    const used = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM freellm_promo_redemptions WHERE promo_code_id = ? AND user_id = ?',
    )
      .bind(promo.id, user.id)
      .first<{ n: number }>()
    if ((used?.n ?? 0) >= promo.per_user_limit) {
      return c.json({ error: 'already_redeemed', message: 'You have already redeemed this code.' }, 409)
    }
    // Nothing else ran — the grant statements are all conditioned on the INSERT.
    return c.json({ error: 'sold_out', message: 'That promo code has just been fully redeemed.' }, 409)
  }

  let scope: { slug: string; label: string } | null = null
  if (promo.model_id) {
    scope = await c.env.DB.prepare('SELECT slug, label FROM freellm_models WHERE id = ?')
      .bind(promo.model_id)
      .first<{ slug: string; label: string }>()
  }

  return c.json({
    redeemed: {
      code: promo.code,
      credits: promo.credits,
      model: scope ? { slug: scope.slug, label: scope.label } : null,
    },
  })
})

// --------------------------------------------------------------- mine

app.get('/api/promos/mine', async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT r.credits, r.created_at, p.code, m.slug AS model_slug, m.label AS model_label
     FROM freellm_promo_redemptions r
     JOIN freellm_promo_codes p ON p.id = r.promo_code_id
     LEFT JOIN freellm_models m ON m.id = r.model_id
     WHERE r.user_id = ?
     ORDER BY r.created_at DESC
     LIMIT 50`,
  )
    .bind(user.id)
    .all<{ credits: number; created_at: number; code: string; model_slug: string | null; model_label: string | null }>()

  return c.json({ redemptions: rows.results })
})

// =====================================================================
// Admin endpoints
// =====================================================================

app.use('/api/admin/promos/*', requireAuth, requireAdmin)

app.get('/api/admin/promos', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.*, m.slug AS model_slug, m.label AS model_label
     FROM freellm_promo_codes p LEFT JOIN freellm_models m ON m.id = p.model_id
     ORDER BY p.created_at DESC`,
  ).all<Record<string, unknown>>()
  return c.json({ promos: rows.results })
})

app.post('/api/admin/promos', async (c) => {
  const admin = c.get('user')
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const code = normalizePromoCode(body.code)
  if (!code) {
    return c.json({ error: 'invalid_input', message: 'Code must be 3–32 chars: A-Z, 0-9, hyphens.' }, 400)
  }

  const credits = Number(body.credits)
  if (!Number.isInteger(credits) || credits <= 0 || credits > 10_000_000) {
    return c.json({ error: 'invalid_input', message: 'Credits must be an integer 1–10,000,000.' }, 400)
  }

  let modelId: string | null = null
  let modelLabel: string | null = null
  if (body.model_slug) {
    const slug = slugify(String(body.model_slug))
    const model = await c.env.DB.prepare('SELECT id, label FROM freellm_models WHERE slug = ?').bind(slug).first<ModelRow & { label: string }>()
    if (!model) return c.json({ error: 'invalid_input', message: `No alias with slug "${slug}".` }, 400)
    modelId = model.id
    modelLabel = model.label
  }

  const perUserLimit = body.per_user_limit == null ? 1 : Number(body.per_user_limit)
  if (!Number.isInteger(perUserLimit) || perUserLimit < 1 || perUserLimit > 100) {
    return c.json({ error: 'invalid_input', message: 'Per-user limit must be an integer 1–100.' }, 400)
  }

  let maxRedemptions: number | null = null
  if (body.max_redemptions != null && body.max_redemptions !== '') {
    maxRedemptions = Number(body.max_redemptions)
    if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 1_000_000) {
      return c.json({ error: 'invalid_input', message: 'Max redemptions must be an integer 1–1,000,000.' }, 400)
    }
  }

  const minAge = body.min_account_age_hours == null ? 0 : Number(body.min_account_age_hours)
  if (!Number.isInteger(minAge) || minAge < 0 || minAge > 8760) {
    return c.json({ error: 'invalid_input', message: 'Min account age must be 0–8760 hours.' }, 400)
  }

  const toTimestamp = (value: unknown, field: string): number | null => {
    if (value == null || value === '') return null
    const parsed = typeof value === 'number' ? value : new Date(String(value)).getTime()
    if (!Number.isFinite(parsed)) {
      throw new HttpError(400, 'invalid_input', `${field} must be an ISO date or unix ms.`)
    }
    return parsed
  }

  let startsAt: number | null
  let expiresAt: number | null
  try {
    startsAt = toTimestamp(body.starts_at, 'starts_at')
    expiresAt = toTimestamp(body.expires_at, 'expires_at')
  } catch (err) {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status)
    throw err
  }
  if (startsAt && expiresAt && expiresAt <= startsAt) {
    return c.json({ error: 'invalid_input', message: 'Expiry must be after the start date.' }, 400)
  }

  const id = newId()
  const timestamp = now()
  try {
    await c.env.DB.prepare(
      `INSERT INTO freellm_promo_codes (id, code, description, credits, model_id, max_redemptions, redemption_count,
                                per_user_limit, min_account_age_hours, starts_at, expires_at, active,
                                created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
      .bind(
        id,
        code,
        body.description ? String(body.description).slice(0, 300) : null,
        credits,
        modelId,
        maxRedemptions,
        perUserLimit,
        minAge,
        startsAt,
        expiresAt,
        admin.id,
        timestamp,
        timestamp,
      )
      .run()
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_promo_codes.code')) {
      return c.json({ error: 'code_taken', message: 'That code already exists.' }, 409)
    }
    throw err
  }

  const promo = await c.env.DB.prepare('SELECT * FROM freellm_promo_codes WHERE id = ?').bind(id).first()
  return c.json({ promo: { ...promo, model_label: modelLabel } }, 201)
})

app.patch('/api/admin/promos/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT * FROM freellm_promo_codes WHERE id = ?').bind(id).first<{ id: string }>()
  if (!existing) return c.json({ error: 'not_found', message: 'Promo code not found.' }, 404)

  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body) return c.json({ error: 'invalid_body', message: 'Send JSON.' }, 400)

  const updates: Record<string, unknown> = {}

  if (body.description !== undefined) updates.description = String(body.description).slice(0, 300)
  if (body.active !== undefined) updates.active = body.active ? 1 : 0
  if (body.per_user_limit !== undefined) {
    const value = Number(body.per_user_limit)
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      return c.json({ error: 'invalid_input', message: 'Per-user limit must be an integer 1–100.' }, 400)
    }
    updates.per_user_limit = value
  }
  if (body.max_redemptions !== undefined) {
    if (body.max_redemptions === null || body.max_redemptions === '') {
      updates.max_redemptions = null
    } else {
      const value = Number(body.max_redemptions)
      if (!Number.isInteger(value) || value < 1 || value > 1_000_000) {
        return c.json({ error: 'invalid_input', message: 'Max redemptions must be an integer 1–1,000,000.' }, 400)
      }
      updates.max_redemptions = value
    }
  }
  if (body.expires_at !== undefined) {
    if (body.expires_at === null || body.expires_at === '') {
      updates.expires_at = null
    } else {
      const parsed = new Date(String(body.expires_at)).getTime()
      if (!Number.isFinite(parsed)) {
        return c.json({ error: 'invalid_input', message: 'Expiry must be an ISO date or null.' }, 400)
      }
      updates.expires_at = parsed
    }
  }
  if (body.model_slug !== undefined) {
    if (body.model_slug === null || body.model_slug === '') {
      updates.model_id = null
    } else {
      const slug = slugify(String(body.model_slug))
      const model = await c.env.DB.prepare('SELECT id FROM freellm_models WHERE slug = ?').bind(slug).first<{ id: string }>()
      if (!model) return c.json({ error: 'invalid_input', message: `No alias with slug "${slug}".` }, 400)
      updates.model_id = model.id
    }
  }

  const columns = Object.keys(updates)
  if (columns.length === 0) return c.json({ error: 'invalid_input', message: 'Nothing to update.' }, 400)

  updates.updated_at = now()
  const assignments = columns.map((column) => `${column} = ?`).join(', ')
  await c.env.DB.prepare(`UPDATE freellm_promo_codes SET ${assignments} WHERE id = ?`)
    .bind(...columns.map((column) => updates[column]), id)
    .run()

  const promo = await c.env.DB.prepare(
    `SELECT p.*, m.slug AS model_slug, m.label AS model_label
     FROM freellm_promo_codes p LEFT JOIN freellm_models m ON m.id = p.model_id WHERE p.id = ?`,
  )
    .bind(id)
    .first()
  return c.json({ promo })
})

app.delete('/api/admin/promos/:id', async (c) => {
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare('SELECT id FROM freellm_promo_codes WHERE id = ?').bind(id).first()
  if (!existing) return c.json({ error: 'not_found', message: 'Promo code not found.' }, 404)
  await c.env.DB.prepare('DELETE FROM freellm_promo_codes WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

app.get('/api/admin/promos/:id/redemptions', async (c) => {
  const id = c.req.param('id')
  const rows = await c.env.DB.prepare(
    `SELECT r.credits, r.created_at, u.username, u.email, m.label AS model_label
     FROM freellm_promo_redemptions r
     JOIN freellm_users u ON u.id = r.user_id
     LEFT JOIN freellm_models m ON m.id = r.model_id
     WHERE r.promo_code_id = ?
     ORDER BY r.created_at DESC
     LIMIT 200`,
  )
    .bind(id)
    .all<{ credits: number; created_at: number; username: string; email: string; model_label: string | null }>()
  return c.json({ redemptions: rows.results })
})

class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export default app
