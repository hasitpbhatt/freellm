// Metering: reserve-settle accounting over two balance layers.
//
// Balances
//   global  — freellm_users.balance_credits (any model)
//   scoped  — freellm_model_credit_grants.credits (one alias)
//
// Spend order: scoped grant for THIS alias first, then global. Every charge
// writes exactly one freellm_usage_events row (idempotent by request_id) and one
// freellm_credit_ledger row whose delta is the global portion; the scoped portion
// lives in the grants table and the usage event's meta.
//
// Sources of truth:
//   reported  — provider's usage block (input + output + total)
//   flat_rate — alias flat_rate_credits, charged when the provider omits
//               usage or the stream was aborted before the final chunk

import { newId } from './crypto'
import type { ModelRow } from './types'
import { expireAdminGrants } from './credit-grants'
import { expirePromoCredits } from './promo-expiry'

const HOLD_STALE_MS = 10 * 60 * 1000

export type Spendable = { global: number; scoped: number; held: number; available: number; total: number }

/** Global + scoped-for-this-alias minus outstanding holds. */
export async function computeSpendable(
  db: D1Database,
  userId: string,
  globalBalance: number,
  modelId: string,
  excludeRequestId?: string,
): Promise<Spendable> {
  // Lazy expiry sweeps: claw back expired promo grants and timed-out admin
  // grants before the balance is read, so hoarded expiring credits can't be
  // spent past their deadline. Best-effort — a race just defers to the next sweep.
  await expirePromoCredits(db, userId).catch(() => {})
  await expireAdminGrants(db, userId).catch(() => {})
  // The passed-in globalBalance is the session-cached value, now potentially
  // stale after the sweep clawed credits back. Re-read the authoritative
  // balance so the reserve gate sees the post-expiry figure.
  const freshUser = await db
    .prepare('SELECT balance_credits FROM freellm_users WHERE id = ?')
    .bind(userId)
    .first<{ balance_credits: number }>()
  const effectiveGlobal = freshUser?.balance_credits ?? globalBalance
  // The stale-hold sweep and the grant read are independent; the held-sum
  // read must follow the sweep, so only those two are overlapped. One
  // cutoff for both — computing Date.now() twice let a hold created between
  // the two reads be deleted and then not counted.
  const cutoff = Date.now() - HOLD_STALE_MS
  const [, grant] = await Promise.all([
    db.prepare('DELETE FROM freellm_credit_holds WHERE created_at <= ?').bind(cutoff).run(),
    db
      .prepare('SELECT credits FROM freellm_model_credit_grants WHERE user_id = ? AND model_id = ?')
      .bind(userId, modelId)
      .first<{ credits: number }>(),
  ])

  const held = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM freellm_credit_holds
       WHERE user_id = ? AND created_at > ? ${excludeRequestId ? 'AND request_id != ?' : ''}`,
    )
    .bind(...(excludeRequestId ? [userId, cutoff, excludeRequestId] : [userId, cutoff]))
    .first<{ total: number }>()

  const scoped = grant?.credits ?? 0
  const heldAmount = held?.total ?? 0
  const total = effectiveGlobal + scoped
  return { global: effectiveGlobal, scoped, held: heldAmount, available: total - heldAmount, total }
}

export async function placeHold(db: D1Database, userId: string, requestId: string, amount: number): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO freellm_credit_holds (request_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)')
    .bind(requestId, userId, amount, Date.now())
    .run()
}

export async function releaseHold(db: D1Database, requestId: string): Promise<void> {
  await db.prepare('DELETE FROM freellm_credit_holds WHERE request_id = ?').bind(requestId).run()
}

export type Usage = { input: number; output: number; total: number }

/** Provider-reported counts are untrusted input — reject garbage before billing. */
export function sanitizeUsage(usage: Usage | null | undefined): Usage | null {
  if (!usage) return null
  const { input, output, total } = usage
  for (const n of [input, output, total]) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null
  }
  if (total > input + output + 1000) return null
  if (total === 0 && (input > 0 || output > 0)) return null
  // Lower bound: total_tokens is always >= prompt_tokens and >= completion_tokens
  // in every real provider. A host that reports total=1 with input/output in the
  // thousands is trying to under-charge the pool — reject and fall back to flat rate.
  if (total < input || total < output) return null
  return { input, output, total }
}

export type Settlement =
  | { kind: 'completed'; usage: Usage | null }
  | { kind: 'aborted'; reason?: string }
  | { kind: 'failed'; reason?: string }

/**
 * Settles a request: writes the usage event, moves the credits (scoped
 * first), releases the hold, and returns what was charged. Idempotent —
 * a retry with the same request_id returns the original result untouched.
 * When free=true (BYOK mode): charge=0, no balance/ledger/grant changes,
 * key_mode='byok' in freellm_usage_events.
 */
export async function settleRequest(
  db: D1Database,
  params: {
    userId: string
    requestId: string
    model: ModelRow
    providerLabel: string
    settlement: Settlement
    latencyMs: number
    battleId?: string
    usage?: Usage | null
    free?: boolean
  },
): Promise<{ creditsCharged: number; source: 'reported' | 'flat_rate'; status: string; balance: { global: number; scoped: number }; alreadySettled: boolean }> {
  const { userId, requestId, model, settlement, latencyMs, usage, free } = params
  const isFree = free === true

  const existing = await db
    .prepare('SELECT credits_charged, source, status FROM freellm_usage_events WHERE request_id = ?')
    .bind(requestId)
    .first<{ credits_charged: number; source: 'reported' | 'flat_rate'; status: string }>()
  if (existing) {
    const balances = await readBalances(db, userId, model.id)
    return {
      creditsCharged: existing.credits_charged,
      source: existing.source,
      status: existing.status,
      balance: balances,
      alreadySettled: true,
    }
  }

  const user = await db.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?').bind(userId).first<{ balance_credits: number }>()
  if (!user) throw new Error('user vanished mid-request')

  const grant = await db
    .prepare('SELECT credits FROM freellm_model_credit_grants WHERE user_id = ? AND model_id = ?')
    .bind(userId, model.id)
    .first<{ credits: number }>()

  let source: 'reported' | 'flat_rate'
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let totalTokens: number | null = null
  let status: 'completed' | 'aborted' | 'failed'
  let charge: number

  if (isFree) {
    status = settlement.kind === 'failed' ? 'failed' : settlement.kind === 'aborted' ? 'aborted' : 'completed'
    const clean = sanitizeUsage(usage ?? null)
    source = clean ? 'reported' : 'flat_rate'
    inputTokens = clean?.input ?? null
    outputTokens = clean?.output ?? null
    totalTokens = clean?.total ?? null
    charge = 0
  } else if (settlement.kind === 'completed') {
    status = 'completed'
    const clean = sanitizeUsage(settlement.usage)
    if (clean) {
      source = 'reported'
      inputTokens = clean.input
      outputTokens = clean.output
      totalTokens = clean.total
      charge = clean.total
    } else {
      source = 'flat_rate'
      charge = model.flat_rate_credits
    }
  } else if (settlement.kind === 'aborted') {
    source = 'flat_rate'
    status = 'aborted'
    charge = model.flat_rate_credits
  } else {
    source = 'flat_rate'
    status = 'failed'
    charge = 0
  }

  const scopedAvailable = grant?.credits ?? 0
  // Scoped-only aliases (luna-class): global balance can never pay here, so a
  // caller without this alias's tokens cannot burn its provider quota.
  const scopedOnly = model.scoped_only === 1 && !isFree
  const fromScoped = Math.min(scopedAvailable, charge)
  const fromGlobal = scopedOnly ? 0 : charge - fromScoped

  // A scoped-only shortfall is a JS-side condition (the conditional debit
  // below can't express "no global allowed"); fail before any write.
  if (scopedOnly && fromScoped < charge) {
    await releaseHold(db, requestId).catch(() => {})
    throw new Error('insufficient credits at settlement')
  }

  // Gate the spend BEFORE anything is written. The old check compared
  // fromGlobal against the raw balance_credits in JS, ignoring the
  // outstanding holds the reserve exists to protect — two concurrent
  // settlements both passed and drove the balance negative (the CHECK
  // constraint only rejects the UPDATE, after the other one charged).
  // The condition now lives inside the debit, so SQLite decides
  // atomically: balance - charge must still cover every OTHER request's
  // outstanding reserve.
  const timestamp = Date.now()

  if (!isFree && fromGlobal > 0) {
    const debit = await db
      .prepare(
        `UPDATE freellm_users SET balance_credits = balance_credits - ?, updated_at = ?
         WHERE id = ? AND balance_credits - ? >= (
           SELECT COALESCE(SUM(amount), 0) FROM freellm_credit_holds WHERE user_id = ? AND request_id != ?
         )`,
      )
      .bind(fromGlobal, timestamp, userId, fromGlobal, userId, requestId)
      .run()
    if ((debit?.meta?.changes ?? 0) === 0) {
      await releaseHold(db, requestId).catch(() => {})
      throw new Error('insufficient credits at settlement')
    }
  }

  if (!isFree && fromScoped > 0) {
    const grantDebit = await db
      .prepare(
        `UPDATE freellm_model_credit_grants SET credits = credits - ?, updated_at = ?
         WHERE user_id = ? AND model_id = ? AND credits >= ?`,
      )
      .bind(fromScoped, timestamp, userId, model.id, fromScoped)
      .run()
    if ((grantDebit?.meta?.changes ?? 0) === 0) {
      await releaseHold(db, requestId).catch(() => {})
      throw new Error('insufficient credits at settlement')
    }
  }

  const keyMode = isFree ? 'byok' : 'pool'
  const statements = [
    db
      .prepare(
        `INSERT INTO freellm_usage_events (id, request_id, user_id, model, provider, source, input_tokens,
                                   output_tokens, total_tokens, credits_charged, status, key_mode,
                                   latency_ms, battle_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId(),
        requestId,
        userId,
        model.slug,
        params.providerLabel,
        source,
        inputTokens,
        outputTokens,
        totalTokens,
        charge,
        status,
        keyMode,
        latencyMs,
        params.battleId ?? null,
        timestamp,
      ),
    db.prepare('DELETE FROM freellm_credit_holds WHERE request_id = ?').bind(requestId),
  ]

  if (!isFree && fromGlobal > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO freellm_credit_ledger (id, user_id, delta, reason, meta, created_at)
           VALUES (?, ?, ?, 'chat_spend', ?, ?)`,
        )
        .bind(
          newId(),
          userId,
          -fromGlobal,
          JSON.stringify({
            request_id: requestId,
            model: model.slug,
            source,
            total_tokens: totalTokens,
            from_scoped: fromScoped,
            status,
          }),
          timestamp,
        ),
    )
  }

  try {
    await db.batch(statements)
  } catch (err) {
    // Concurrent retry with the same request_id won the race — refund the
    // gate debit made above and replay the original instead of throwing
    // UNIQUE (and instead of double-charging the user).
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_usage_events.request_id')) {
      if (!isFree && fromGlobal > 0) {
        await db
          .prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?')
          .bind(fromGlobal, Date.now(), userId)
          .run()
      }
      const winner = await db
        .prepare('SELECT credits_charged, source, status FROM freellm_usage_events WHERE request_id = ?')
        .bind(requestId)
        .first<{ credits_charged: number; source: 'reported' | 'flat_rate'; status: string }>()
      if (winner) {
        const balances = await readBalances(db, userId, model.id)
        return {
          creditsCharged: winner.credits_charged,
          source: winner.source,
          status: winner.status,
          balance: balances,
          alreadySettled: true,
        }
      }
    }
    throw err
  }

  const balances = await readBalances(db, userId, model.id)
  return { creditsCharged: charge, source, status, balance: balances, alreadySettled: false }
}

async function readBalances(db: D1Database, userId: string, modelId: string): Promise<{ global: number; scoped: number }> {
  const user = await db.prepare('SELECT balance_credits FROM freellm_users WHERE id = ?').bind(userId).first<{ balance_credits: number }>()
  const grant = await db
    .prepare('SELECT credits FROM freellm_model_credit_grants WHERE user_id = ? AND model_id = ?')
    .bind(userId, modelId)
    .first<{ credits: number }>()
  return { global: user?.balance_credits ?? 0, scoped: grant?.credits ?? 0 }
}

/**
 * Cheap char/4 input estimate — used ONLY to bound the reserve. Billing
 * always uses provider-reported numbers or the flat rate, never this.
 */
export function estimateReserve(messages: { content: string }[], maxOutputTokens: number): number {
  let chars = 0
  for (const message of messages) chars += message.content.length
  const inputEstimate = Math.ceil(chars / 4) + messages.length * 4
  return inputEstimate + maxOutputTokens
}