// Regression test for the Oct 2026 production incident: migration 0011 rebuilt
// freellm_models with DROP TABLE, and D1's enforced ON DELETE CASCADE wiped
// every row in freellm_model_providers. Migrations that rebuild a parent
// table must back up and restore the child. This test applies migrations in
// two stages around seeded rows and proves nothing is lost.

import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Miniflare } from 'miniflare'
import type { D1Database } from '@cloudflare/workers-types'

const migrationsDir = join(__dirname, '..', '..', 'migrations')

let db: D1Database
let dispose: () => Promise<void>

function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
  return withoutComments
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !/^PRAGMA\b/i.test(chunk))
}

async function apply(names: string[]): Promise<void> {
  for (const name of names) {
    const sql = readFileSync(join(migrationsDir, name), 'utf8')
    const statements = splitStatements(sql).map((chunk) => db.prepare(chunk))
    if (statements.length > 0) await db.batch(statements)
  }
}

function ordered(names: string[]): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => names.some((n) => name.startsWith(n)))
}

before(async () => {
  const mf = new Miniflare({
    script: 'export default { fetch() { return new Response("ok") } }',
    modules: true,
    compatibilityDate: '2026-05-03',
    d1Databases: { DB: 'migration-safety-db' },
  })
  db = (await mf.getD1Database('DB')) as unknown as D1Database
  dispose = () => mf.dispose()
})

after(async () => {
  if (dispose) await dispose()
})

test('parent-table rebuild preserves provider configs and billing history shape', async () => {
  await apply(ordered(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010']))

  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO freellm_models (id, slug, label, capabilities, flat_rate_credits, routing, active, sort_order, created_at, updated_at)
       VALUES ('m1', 'm1', 'M1', '[]', 2000, 'failover', 1, 0, ?, ?)`,
    )
    .bind(now, now)
    .run()
  await db
    .prepare(
      `INSERT INTO freellm_model_providers (id, model_id, label, base_url, upstream_model, api_key_ciphertext, api_key_iv,
                                            status, priority, active, messages_served, consecutive_failures, cooldown_until, created_at, updated_at)
       VALUES ('p1', 'm1', 'pool-key-1', 'https://x.example/v1', 'm', 'cipher', 'iv', 'live', 0, 1, 7, 0, NULL, ?, ?)`,
    )
    .bind(now, now)
    .run()
  const before = await db.prepare('SELECT * FROM freellm_model_providers WHERE id = ?').bind('p1').first()

  await apply(ordered(['0011', '0012']))

  const models = await db.prepare('SELECT COUNT(*) AS n FROM freellm_models').first<{ n: number }>()
  const providers = await db.prepare('SELECT COUNT(*) AS n FROM freellm_model_providers').first<{ n: number }>()
  assert.equal(models?.n, 1)
  assert.equal(providers?.n, 1)

  const after = await db.prepare('SELECT * FROM freellm_model_providers WHERE id = ?').bind('p1').first()
  assert.deepEqual(after, { ...before, cooldown_until: before?.cooldown_until ?? null })

  // The widened CHECK actually accepts the new strategy, and tier defaults land.
  await db.prepare(`UPDATE freellm_models SET routing = 'latency_weighted' WHERE id = 'm1'`).run()
  const tiered = await db
    .prepare('SELECT routing, access_tier FROM freellm_models WHERE id = ?')
    .bind('m1')
    .first<{ routing: string; access_tier: string }>()
  assert.deepEqual(tiered, { routing: 'latency_weighted', access_tier: 'free' })
})
