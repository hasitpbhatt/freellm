// One-off admin credit grants with an optional expiry ("timer").
//
// A grant pushes credits straight onto one user's global balance (no code to
// redeem). With an `expires_at`, the unspent portion is clawed back by the
// lazy sweep below — same shape as promo-expiry's clawBack, but simpler: admin
// grants are always global, never model-scoped. The sweep runs wherever
// expirePromoCredits runs (spendable check, balance endpoint), so timed grants
// can't be spent past their deadline.
//
// Idempotency and races mirror promo-expiry: the `expired_at` flip is the
// race gate (guarded UPDATE ... WHERE expired_at IS NULL) and the deduction +
// ledger rows are conditioned on that flip, so concurrent sweeps claw back
// exactly once. A concurrent spend that moves the balance between our read
// and write fails the batch and leaves expired_at NULL for the next sweep.

import { newId } from './crypto'

export const ADMIN_GRANT_MAX_CREDITS = 10_000_000
/** Timed grants live at most a year — a typo'd year-2100 timer must not park debt forever. */
export const ADMIN_GRANT_MAX_TTL_MS = 366 * 24 * 60 * 60 * 1000

export interface AdminGrantInput {
  credits: number
  /** Unix ms, or null for a grant that never expires. */
  expiresAt: number | null
  note: string | null
}

/** Validates the admin grant body; returns the grant input or a user-facing error. */
export function validateAdminGrantInput(
  body: Record<string, unknown>,
  nowMs = Date.now(),
): { input: AdminGrantInput } | { error: string } {
  if (typeof body.credits === 'boolean') {
    return { error: `Credits must be an integer 1–${ADMIN_GRANT_MAX_CREDITS.toLocaleString('en-US')}.` }
  }
  const credits = Number(body.credits)
  if (!Number.isInteger(credits) || credits <= 0 || credits > ADMIN_GRANT_MAX_CREDITS) {
    return { error: `Credits must be an integer 1–${ADMIN_GRANT_MAX_CREDITS.toLocaleString('en-US')}.` }
  }

  let expiresAt: number | null = null
  const rawExpiry = body.expires_at
  if (rawExpiry != null && rawExpiry !== '') {
    const parsed = typeof rawExpiry === 'number' ? rawExpiry : new Date(String(rawExpiry)).getTime()
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      return { error: 'Expiry must be unix ms or an ISO date, or blank for no expiry.' }
    }
    if (parsed <= nowMs) {
      return { error: 'Expiry must be in the future.' }
    }
    if (parsed - nowMs > ADMIN_GRANT_MAX_TTL_MS) {
      return { error: 'Expiry must be within a year.' }
    }
    expiresAt = parsed
  }

  let note: string | null = null
  if (body.note != null && String(body.note).trim() !== '') {
    note = String(body.note).trim().slice(0, 300)
  }

  return { input: { credits, expiresAt, note } }
}

type ExpiredGrantRow = { id: string; credits: number }

/** Claws back timed-out admin grants for one user. Returns total credits clawed. */
export async function expireAdminGrants(
  db: D1Database,
  userId: string,
  nowMs = Date.now(),
): Promise<number> {
  const expired = await db
    .prepare(
      `SELECT id, credits FROM freellm_admin_grants
       WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= ? AND expired_at IS NULL`,
    )
    .bind(userId, nowMs)
    .all<ExpiredGrantRow>()

  let clawed = 0
  for (const row of expired.results) {
    try {
      clawed += await clawBackGrant(db, userId, row, nowMs)
    } catch {
      // A concurrent spend moved the balance between our read and write;
      // leave expired_at NULL so the next sweep retries.
    }
  }
  return clawed
}

/**
 * Claws back one expired grant: the unspent portion, min(grant, current
 * balance) — anything already spent stays spent. Never drives the balance
 * negative: the debit is conditional on the balance still covering it.
 */
async function clawBackGrant(
  db: D1Database,
  userId: string,
  row: ExpiredGrantRow,
  timestamp: number,
): Promise<number> {
  const current = await db
    .prepare('SELECT balance_credits AS credits FROM freellm_users WHERE id = ?')
    .bind(userId)
    .first<{ credits: number }>()
  const amount = Math.min(row.credits, current?.credits ?? 0)

  const flip = db
    .prepare('UPDATE freellm_admin_grants SET expired_at = ? WHERE id = ? AND expired_at IS NULL')
    .bind(timestamp, row.id)

  if (amount <= 0) {
    await db.batch([flip])
    return 0
  }

  const deduct = db
    .prepare(
      `UPDATE freellm_users SET balance_credits = balance_credits - ?, updated_at = ?
       WHERE id = ?
         AND EXISTS (SELECT 1 FROM freellm_admin_grants WHERE id = ? AND expired_at = ?)`,
    )
    .bind(amount, timestamp, userId, row.id, timestamp)

  const ledger = db
    .prepare(
      `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
       SELECT ?, ?, ?, 'grant_expiry', ?, ?
       WHERE EXISTS (SELECT 1 FROM freellm_admin_grants WHERE id = ? AND expired_at = ?)`,
    )
    .bind(newId(), userId, -amount, JSON.stringify({ grant_id: row.id }), timestamp, row.id, timestamp)

  await db.batch([flip, deduct, ledger])
  return amount
}
