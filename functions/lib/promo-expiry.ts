// Promo credit expiry. A redemption of a promo with an `expires_at` snapshots
// that deadline; once past, the unspent portion of the grant is clawed back
// from the pooled balance (per-model grant for scoped promos, global balance
// otherwise). Clawback is lazy and idempotent:
//   - it runs at the top of every spendable check and the balance endpoint,
//   - each redemption is clawed at most once (guarded by its expired_at marker),
//   - a concurrent spend that races the sweep just leaves the redemption
//     un-clawed and it is retried on the next sweep.

import { newId } from './crypto'

type ExpiredRow = { id: string; credits: number; model_id: string | null }

/** Claws back expired promo grants for one user. Returns total credits clawed. */
export async function expirePromoCredits(
  db: D1Database,
  userId: string,
  nowMs = Date.now(),
): Promise<number> {
  const expired = await db
    .prepare(
      `SELECT id, credits, model_id FROM freellm_promo_redemptions
       WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= ? AND expired_at IS NULL`,
    )
    .bind(userId, nowMs)
    .all<ExpiredRow>()

  let clawed = 0
  for (const row of expired.results) {
    try {
      clawed += await clawBack(db, userId, row, nowMs)
    } catch {
      // A concurrent spend moved the balance between our read and write;
      // leave expired_at NULL so the next sweep retries.
    }
  }
  return clawed
}

/**
 * Claws back one expired redemption. The `expired_at` flip is the race gate
 * (guarded UPDATE ... WHERE expired_at IS NULL), and the deduction + ledger
 * entries are conditioned on that flip, so two concurrent sweeps claw back
 * exactly once. The amount is the *unspent* portion: min(grant, current
 * balance) — anything already spent stays spent.
 */
async function clawBack(
  db: D1Database,
  userId: string,
  row: ExpiredRow,
  timestamp: number,
): Promise<number> {
  const current = row.model_id
    ? await db
        .prepare('SELECT credits FROM freellm_model_credit_grants WHERE user_id = ? AND model_id = ?')
        .bind(userId, row.model_id)
        .first<{ credits: number }>()
    : await db
        .prepare('SELECT balance_credits AS credits FROM freellm_users WHERE id = ?')
        .bind(userId)
        .first<{ credits: number }>()
  const amount = Math.min(row.credits, current?.credits ?? 0)

  const flip = db
    .prepare('UPDATE freellm_promo_redemptions SET expired_at = ? WHERE id = ? AND expired_at IS NULL')
    .bind(timestamp, row.id)

  const deduct = row.model_id
    ? db
        .prepare(
          `UPDATE freellm_model_credit_grants SET credits = credits - ?, updated_at = ?
           WHERE user_id = ? AND model_id = ?
             AND EXISTS (SELECT 1 FROM freellm_promo_redemptions WHERE id = ? AND expired_at = ?)`,
        )
        .bind(amount, timestamp, userId, row.model_id, row.id, timestamp)
    : db
        .prepare(
          `UPDATE freellm_users SET balance_credits = balance_credits - ?, updated_at = ?
           WHERE id = ? AND EXISTS (SELECT 1 FROM freellm_promo_redemptions WHERE id = ? AND expired_at = ?)`,
        )
        .bind(amount, timestamp, userId, row.id, timestamp)

  const ledger = db
    .prepare(
      `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
       SELECT ?, ?, ?, 'promo_expiry', ?, ?
       WHERE EXISTS (SELECT 1 FROM freellm_promo_redemptions WHERE id = ? AND expired_at = ?)`,
    )
    .bind(newId(), userId, -amount, JSON.stringify({ redemption_id: row.id }), timestamp, row.id, timestamp)

  await db.batch(amount > 0 ? [flip, deduct, ledger] : [flip])
  return amount
}
