import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import type { D1Database } from '@cloudflare/workers-types'
import { createTestDb, seedUser } from './helpers/db'

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

test('games task seed: SkillArcade task is active with a sane reward', async () => {
  const task = await db
    .prepare('SELECT slug, title, reward, url, active FROM freellm_tasks WHERE slug = ?')
    .bind('play-games')
    .first<{ slug: string; title: string; reward: number; url: string; active: number }>()
  assert.ok(task, 'play-games task seeded')
  assert.equal(task.active, 1)
  assert.ok(task.reward > 0)
  assert.equal(task.url, 'https://games.hasit.in')
})

test('games task claim: verified user can complete it once for the reward', async () => {
  const userId = await seedUser(db, { balanceCredits: 0 })
  const task = await db
    .prepare('SELECT id, reward FROM freellm_tasks WHERE slug = ? AND active = 1')
    .bind('play-games')
    .first<{ id: string; reward: number }>()
  assert.ok(task)
  const now = Date.now()
  await db.batch([
    db
      .prepare('INSERT INTO freellm_task_completions (user_id, task_id, reward, created_at) VALUES (?, ?, ?, ?)')
      .bind(userId, task.id, task.reward, now),
    db.prepare('UPDATE freellm_users SET balance_credits = balance_credits + ?, updated_at = ? WHERE id = ?').bind(
      task.reward,
      now,
      userId,
    ),
  ])
  const user = await db
    .prepare('SELECT balance_credits FROM freellm_users WHERE id = ?')
    .bind(userId)
    .first<{ balance_credits: number }>()
  assert.equal(user?.balance_credits, task.reward)
})
