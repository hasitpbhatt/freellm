import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import { createTestDb } from './helpers/db'

let db: D1Database
let dispose: () => Promise<void>

before(async () => {
  const created = await createTestDb()
  db = created.db
  dispose = created.dispose
})

after(async () => {
  if (dispose) await dispose()
})

test('migrations: BYOK vault stores direct endpoint configuration', async () => {
  const columns = await db
    .prepare("PRAGMA table_info(freellm_api_keys)")
    .all<{ name: string }>()
  const names = new Set(columns.results.map((column) => column.name))

  for (const name of [
    'base_url',
    'upstream_model',
    'status',
    'last_checked_at',
    'avg_latency_ms',
    'active',
    'updated_at',
  ]) {
    assert.equal(names.has(name), true, `missing freellm_api_keys.${name}`)
  }
})
