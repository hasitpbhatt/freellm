// Test harness helpers.
//
// The app targets the Workers runtime, but its lib layer (crypto, metering,
// validate, elo) is pure Web-standard logic. These helpers run the tests on
// Node's built-in runner (`node --test`) against a real, in-process D1 database
// emulated by miniflare (already a dependency of wrangler, so nothing extra is
// installed) with the project's own migrations applied.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Miniflare } from 'miniflare'
import type { D1Database } from '@cloudflare/workers-types'

// Compiled to CommonJS for `node --test` into build-test/tests/helpers/, so
// three levels up is the project root. Using __dirname keeps this identical
// whether the file runs from source or from the compiled output.
const migrationsDir = join(__dirname, '..', '..', '..', 'migrations')

/**
 * Boots a miniflare instance with an isolated D1 database pre-loaded with the
 * project migrations (0001…0010, in filename order — the same order
 * `wrangler d1 migrations apply` uses). Caller owns disposal.
 */
export async function createTestDb(): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
  const mf = new Miniflare({
    script: 'export default { fetch() { return new Response("ok") } }',
    modules: true,
    compatibilityDate: '2026-05-03',
    d1Databases: { DB: 'test-db' },
  })

  const db = (await mf.getD1Database('DB')) as unknown as D1Database

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    const sql = readFileSync(join(migrationsDir, name), 'utf8')
    const statements = splitStatements(sql).map((chunk) => db.prepare(chunk))
    if (statements.length > 0) await db.batch(statements)
  }

  return {
    db,
    dispose: () => mf.dispose(),
  }
}

/**
 * Splits a migration file into executable statements. Comments are stripped
 * first (workerd's exec() rejects comment-only input, and a `--` comment can
 * itself contain a semicolon, which would break naive splitting), as is the
 * PRAGMA — the emulator doesn't accept it, and nothing under test needs it.
 */
function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    // Strip a trailing CR first: on CRLF checkouts `.` never matches `\r`,
    // so the `--` strip below would silently keep every comment line and
    // newer workerd builds reject the resulting comment-only statements.
    .map((line) => line.replace(/\r$/, '').replace(/--.*$/, ''))
    .join('\n')
  return withoutComments
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !/^PRAGMA\b/i.test(chunk))
}

/** The ModelRow shape the app passes into settleRequest. */
export const testModel = {
  id: 'model_test',
  slug: 'test-model',
  label: 'Test Model',
  description: null,
  capabilities: '[]',
  context_window: 8192,
  max_output_tokens: 4096,
  flat_rate_credits: 2000,
  routing: 'round_robin' as const,
  access_tier: 'free' as const,
  scoped_only: 0,
  active: 1,
  sort_order: 0,
  created_at: 0,
  updated_at: 0,
}

/**
 * Seeds a user (and optional per-model grant) into a test DB. Idempotent:
 * prior rows for the fixed test user are cleared first so every test starts
 * from a clean ledger/holds/usage slate on the shared in-memory database.
 */
export async function seedUser(
  db: D1Database,
  opts: { balanceCredits?: number; scopedCredits?: number } = {},
): Promise<string> {
  const userId = 'user_test'
  const now = Date.now()
  await db.batch([
    db.prepare('DELETE FROM freellm_credit_ledger WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM freellm_usage_events WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM freellm_credit_holds WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM freellm_model_credit_grants WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM freellm_users WHERE id = ?').bind(userId),
  ])
  await db
    .prepare(
      `INSERT INTO freellm_users (id, email, username, password_hash, referral_code,
                                   balance_credits, role, email_verified, created_at, updated_at)
       VALUES (?, 'test@example.com', 'tester', NULL, 'testcode1', ?, 'user', 1, ?, ?)`,
    )
    .bind(userId, opts.balanceCredits ?? 0, now, now)
    .run()
  await db
    .prepare(
      `INSERT OR REPLACE INTO freellm_models (id, slug, label, capabilities, flat_rate_credits,
                                    routing, active, sort_order, created_at, updated_at)
       VALUES (?, 'test-model', 'Test Model', '[]', 2000, 'round_robin', 1, 0, ?, ?)`,
    )
    .bind('model_test', now, now)
    .run()
  if (opts.scopedCredits) {
    await db
      .prepare(
        `INSERT INTO freellm_model_credit_grants (id, user_id, model_id, credits, created_at, updated_at)
         VALUES ('grant_test', ?, 'model_test', ?, ?, ?)`,
      )
      .bind(userId, opts.scopedCredits, now, now)
      .run()
  }
  return userId
}

/** Reads the cached balance + scoped grant the way readBalances does. */
export async function readBalances(
  db: D1Database,
  userId: string,
): Promise<{ global: number; scoped: number }> {
  const user = await db
    .prepare('SELECT balance_credits FROM freellm_users WHERE id = ?')
    .bind(userId)
    .first<{ balance_credits: number }>()
  const grant = await db
    .prepare('SELECT credits FROM freellm_model_credit_grants WHERE user_id = ? AND model_id = ?')
    .bind(userId, 'model_test')
    .first<{ credits: number }>()
  return { global: user?.balance_credits ?? 0, scoped: grant?.credits ?? 0 }
}
