// The arena: blind model battles with Elo.
//
//   POST /api/battles            run a battle: 2–4 models answer one prompt,
//                                streamed blinded as labels A/B/C…, metered per model
//   POST /api/battles/:id/vote   one-shot vote; reveals the mapping + Elo deltas
//   GET  /api/battles/:id        battle detail (revealed to viewers who voted)
//   GET  /api/arena              leaderboard + recent battles
//
// Blindness: during the stream answers are keyed by label only; the label →
// model mapping is revealed to a viewer once they vote (LMArena-style).

import { Hono } from 'hono'
import { requireAuth } from '../lib/middleware'
import { newId } from '../lib/crypto'
import { getSession } from '../lib/session'
import { computeSpendable, estimateReserve, placeHold, settleRequest } from '../lib/metering'
import { loadAlias, openCall, recordOutcome, shuffle, type AliasWithProviders, type ChatMessage } from '../lib/providers'
import { canAccessModel, tierGatedMessage } from '../lib/tiers'
import { eloBattle } from '../lib/elo'
import type { Bindings, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const encoder = new TextEncoder()
const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`
const LABELS = ['A', 'B', 'C', 'D']
const MAX_ANSWER_CHARS = 8000
const now = () => Date.now()

type BattleAnswer = { slug: string; content: string; error?: boolean }

// ------------------------------------------------------------ run a battle

app.post('/api/battles', requireAuth, async (c) => {
  const user = c.get('user')
  const payload = await c.req
    .json<{ prompt?: unknown; models?: unknown; request_id?: unknown }>()
    .catch(() => null)

  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : ''
  const slugs = Array.isArray(payload?.models) ? payload.models.filter((s): s is string => typeof s === 'string') : []

  if (!prompt || prompt.length > 4000) {
    return c.json({ error: 'invalid_input', message: 'A prompt of 1–4000 characters is required.' }, 400)
  }
  const uniqueSlugs = [...new Set(slugs.map((s) => s.trim()))]
  if (uniqueSlugs.length < 2 || uniqueSlugs.length > 4) {
    return c.json({ error: 'invalid_input', message: 'Pick 2–4 different models.' }, 400)
  }

  // Load aliases up front; every model must be live in The Pool.
  const aliases: { slug: string; alias: AliasWithProviders }[] = []
  for (const slug of uniqueSlugs) {
    const alias = await loadAlias(c.env, slug)
    if (!alias || alias.providers.length === 0) {
      return c.json({ error: 'model_unavailable', message: `"${slug}" is not in The Pool right now.` }, 404)
    }
    if (!canAccessModel(user, alias.model)) {
      return c.json(
        { error: 'upgrade_required', message: tierGatedMessage(alias.model), required_tier: alias.model.access_tier, model: slug },
        403,
      )
    }
    aliases.push({ slug, alias })
  }

  // Reserve for every model before starting anything.
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }]
  const reserves = aliases.map(({ slug, alias }) => ({
    slug,
    alias,
    reserve: estimateReserve(messages, alias.model.max_output_tokens),
  }))
  const totalReserve = reserves.reduce((sum, r) => sum + r.reserve, 0)
  // Spendable is per-alias (scoped grants differ); sum across the battle.
  const spendables = await Promise.all(
    reserves.map((r) => computeSpendable(c.env.DB, user.id, user.balance_credits, r.alias.model.id)),
  )
  const available = spendables.reduce((sum, s) => sum + s.available, 0)
  if (available < totalReserve) {
    return c.json(
      {
        error: 'insufficient_credits',
        message: `This battle needs about ${totalReserve.toLocaleString('en-US')} cr — you have ${available.toLocaleString('en-US')} spendable.`,
        shortfall: totalReserve - available,
      },
      402,
    )
  }
  // Scoped-only aliases spend their own grant balance only — a battle
  // including one needs that alias's tokens, not just global credits.
  for (let i = 0; i < reserves.length; i += 1) {
    const entry = reserves[i]
    if (entry.alias.model.scoped_only === 1 && spendables[i].scoped < entry.reserve) {
      return c.json(
        {
          error: 'insufficient_scoped_credits',
          message: `${entry.alias.model.label} spends ${entry.alias.model.label} credits only — you have ${spendables[i].scoped.toLocaleString('en-US')} scoped. Redeem a promo code for this model.`,
          shortfall: entry.reserve - spendables[i].scoped,
          scoped: spendables[i].scoped,
          model: entry.slug,
        },
        402,
      )
    }
  }

  // Blind labels: shuffle so A is not always the first model.
  const shuffled = shuffle(reserves)
  const battleId = newId()
  const entries = shuffled.map((entry, index) => ({
    ...entry,
    label: LABELS[index],
    requestId: `${battleId}:${entry.slug}`,
  }))

  const answers: Record<string, BattleAnswer> = {}
  const timestamp = now()
  await c.env.DB.prepare(
    `INSERT INTO freellm_battles (id, user_id, prompt, models, status, created_at) VALUES (?, ?, ?, ?, 'streaming', ?)`,
  )
    .bind(battleId, user.id, prompt, JSON.stringify(uniqueSlugs), timestamp)
    .run()

  // ---- SSE stream ----------------------------------------------------
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const streamBody = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
    },
  })
  const send = (event: unknown) => {
    try {
      controller.enqueue(encoder.encode(sse(event)))
    } catch {
      // client disconnected mid-battle; pumps keep settling regardless
    }
  }

  send({
    type: 'battle',
    id: battleId,
    prompt,
    labels: entries.map((e) => ({ label: e.label, estimate: e.reserve })),
  })

  const pumps = entries.map(async (entry) => {
    const { label, alias, requestId, reserve } = entry
    send({ type: 'start', label })

    await placeHold(c.env.DB, user.id, requestId, reserve)

    const opened = await openCall(c.env, alias, messages, { maxTokens: alias.model.max_output_tokens })
    if ('error' in opened) {
      const result = await settleRequest(c.env.DB, {
        userId: user.id,
        requestId,
        model: alias.model,
        providerLabel: 'battle-failed',
        settlement: { kind: 'failed', reason: opened.error },
        latencyMs: 0,
        battleId,
      })
      send({ type: 'error', label, message: `${alias.model.label} failed — no charge.` })
      answers[label] = { slug: alias.model.slug, content: '', error: true }
      void result
      return
    }

    const { provider, key, response } = opened
    const streamStart = Date.now()

    // If the upstream doesn't support streaming, handle it without streaming
    if (!opened.streaming) {
      const text = await response.text()
      let parsed: any = {}
      try { parsed = JSON.parse(text) } catch {}
      const content = parsed.choices?.[0]?.message?.content ?? ''
      const usage = parsed.usage ? { input: parsed.usage.prompt_tokens, output: parsed.usage.completion_tokens, total: parsed.usage.total_tokens } : null
      send({ type: 'delta', label, content })
      const result = await settleRequest(c.env.DB, {
        userId: user.id,
        requestId,
        model: alias.model,
        providerLabel: provider.upstream.label,
        settlement: { kind: 'completed', usage },
        latencyMs: Date.now() - streamStart,
        battleId,
      })
      await recordOutcome(c.env, provider.upstream.id, provider.id, { ok: true, latencyMs: Date.now() - streamStart, keyId: key.id })
      answers[label] = { slug: alias.model.slug, content: content.slice(0, MAX_ANSWER_CHARS) }
      send({ type: 'settled', label, credits: result.creditsCharged, source: result.source, usage })
      return
    }

    let content = ''
    let usage: { input: number; output: number; total: number } | null = null
    let buffer = ''
    const decoder = new TextDecoder()

    try {
      const reader = response.body!.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          let chunk: Record<string, unknown>
          try {
            chunk = JSON.parse(payload)
          } catch {
            continue
          }
          const choices = chunk.choices as { delta?: { content?: string } }[] | undefined
          const delta = choices?.[0]?.delta?.content
          if (typeof delta === 'string' && delta.length > 0) {
            content += delta
            send({ type: 'delta', label, content: delta })
          }
          const usageChunk = chunk.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
          if (
            usageChunk &&
            typeof usageChunk.prompt_tokens === 'number' &&
            typeof usageChunk.completion_tokens === 'number' &&
            typeof usageChunk.total_tokens === 'number'
          ) {
            usage = { input: usageChunk.prompt_tokens, output: usageChunk.completion_tokens, total: usageChunk.total_tokens }
          }
        }
      }
    } catch (err) {
      // stream broke mid-flight: settle what we have
      await recordOutcome(c.env, provider.upstream.id, provider.id, {
        ok: false,
        latencyMs: Date.now() - streamStart,
        error: err instanceof Error ? err.message : 'stream error',
      })
      const result = await settleRequest(c.env.DB, {
        userId: user.id,
        requestId,
        model: alias.model,
        providerLabel: provider.upstream.label,
        settlement: { kind: 'failed', reason: 'stream error' },
        latencyMs: Date.now() - streamStart,
        battleId,
      })
      send({ type: 'error', label, message: `${alias.model.label} stream broke — no charge.` })
      answers[label] = { slug: alias.model.slug, content, error: true }
      void result
      return
    }

    const result = await settleRequest(c.env.DB, {
      userId: user.id,
      requestId,
      model: alias.model,
      providerLabel: provider.upstream.label,
      settlement: { kind: 'completed', usage },
      latencyMs: Date.now() - streamStart,
      battleId,
    })

    await recordOutcome(c.env, provider.upstream.id, provider.id, { ok: true, latencyMs: Date.now() - streamStart, keyId: key.id })

    answers[label] = { slug: alias.model.slug, content: content.slice(0, MAX_ANSWER_CHARS) }
    send({
      type: 'settled',
      label,
      credits: result.creditsCharged,
      source: result.source,
      usage: usage ? { input: usage.input, output: usage.output, total: usage.total } : null,
    })

    // Persist progress so a refresh can show completed columns.
    await c.env.DB.prepare('UPDATE freellm_battles SET answers = ? WHERE id = ?')
      .bind(JSON.stringify(answers), battleId)
      .run()
  })

  await Promise.all(pumps)
  await c.env.DB.prepare("UPDATE freellm_battles SET status = 'complete', answers = ? WHERE id = ?")
    .bind(JSON.stringify(answers), battleId)
    .run()

  send({ type: 'done', battle_id: battleId })
  try {
    controller.close()
  } catch {
    // already closed by disconnect
  }

  return new Response(streamBody, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Battle-Id': battleId,
    },
  })
})

// ------------------------------------------------------------------- vote

app.post('/api/battles/:id/vote', requireAuth, async (c) => {
  const user = c.get('user')
  const battleId = c.req.param('id')
  const body = await c.req.json<{ label?: unknown }>().catch(() => null)
  const label = typeof body?.label === 'string' ? body.label.trim().toUpperCase() : ''
  if (!LABELS.includes(label)) {
    return c.json({ error: 'invalid_input', message: 'Vote with a label: A, B, C, or D.' }, 400)
  }

  const battle = await c.env.DB.prepare('SELECT * FROM freellm_battles WHERE id = ?').bind(battleId).first<{
    id: string
    user_id: string
    prompt: string
    models: string
    status: string
    answers: string | null
  }>()
  if (!battle) return c.json({ error: 'not_found', message: 'Battle not found.' }, 404)

  const answers = safeParse<Record<string, BattleAnswer>>(battle.answers) ?? {}
  const winner = answers[label]
  // The vote must not be able to award Elo to a column that errored out and
  // returned nothing — the SPA hides the button, the API must not rely on it.
  if (!winner || winner.error) return c.json({ error: 'invalid_label', message: 'No answer for that label.' }, 400)

  const already = await c.env.DB.prepare('SELECT 1 AS x FROM freellm_battle_votes WHERE battle_id = ? AND user_id = ?')
    .bind(battleId, user.id)
    .first()
  if (already) return c.json({ error: 'already_voted', message: 'You already voted in this battle.' }, 409)

  // Elo over the battle's freellm_models.
  const slugs = Object.values(answers).map((a) => a.slug)
  const ratingRows = await c.env.DB.prepare(
    `SELECT slug, elo_rating, elo_games FROM freellm_models WHERE slug IN (${slugs.map(() => '?').join(',')})`,
  )
    .bind(...slugs)
    .all<{ slug: string; elo_rating: number; elo_games: number }>()
  const ratings = new Map(ratingRows.results.map((r) => [r.slug, { rating: r.elo_rating, games: r.elo_games }]))
  const updates = eloBattle(ratings, winner.slug)

  const timestamp = now()
  // The vote INSERT is the race guard: its PRIMARY KEY (battle_id, user_id)
  // rejects the loser, which rolls the whole batch back (so no Elo update
  // lands for the loser either) and surfaces as a friendly already_voted
  // instead of the raw UNIQUE-constraint 500 the un-guarded batch threw.
  const statements = [
    c.env.DB.prepare('INSERT INTO freellm_battle_votes (battle_id, user_id, model, created_at) VALUES (?, ?, ?, ?)').bind(
      battleId,
      user.id,
      winner.slug,
      timestamp,
    ),
  ]
  for (const update of updates) {
    statements.push(
      c.env.DB.prepare(
        `UPDATE freellm_models SET elo_rating = ?, elo_games = elo_games + 1, elo_wins = elo_wins + ?, updated_at = ?
         WHERE slug = ? AND EXISTS (SELECT 1 FROM freellm_battle_votes WHERE battle_id = ? AND user_id = ?)`,
      ).bind(update.after, update.slug === winner.slug ? 1 : 0, timestamp, update.slug, battleId, user.id),
    )
  }
  try {
    await c.env.DB.batch(statements)
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed: freellm_battle_votes')) {
      return c.json({ error: 'already_voted', message: 'You already voted in this battle.' }, 409)
    }
    throw err
  }

  return c.json({
    voted: winner.slug,
    revealed: Object.entries(answers).map(([entryLabel, answer]) => ({
      label: entryLabel,
      slug: answer.slug,
      error: answer.error ?? false,
    })),
    elo: updates,
  })
})

// ------------------------------------------------------------ battle detail

app.get('/api/battles/:id', async (c) => {
  const battleId = c.req.param('id')
  const battle = await c.env.DB.prepare('SELECT * FROM freellm_battles WHERE id = ?').bind(battleId).first<{
    id: string
    user_id: string
    prompt: string
    models: string
    status: string
    answers: string | null
    created_at: number
  }>()
  if (!battle) return c.json({ error: 'not_found', message: 'Battle not found.' }, 404)

  // Reveal only to viewers who voted; everyone else sees labels until then.
  let viewerVoted = false
  const session = await getSession(c.env.freellm_sessions, c.req.header('cookie'))
  if (session) {
    const vote = await c.env.DB.prepare('SELECT 1 AS x FROM freellm_battle_votes WHERE battle_id = ? AND user_id = ?')
      .bind(battleId, session.userId)
      .first()
    viewerVoted = !!vote
  }
  const totalVotes = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM freellm_battle_votes WHERE battle_id = ?')
    .bind(battleId)
    .first<{ n: number }>()

  const answers = safeParse<Record<string, BattleAnswer>>(battle.answers) ?? {}
  const revealed = viewerVoted
  const columns = LABELS.filter((l) => answers[l]).map((l) => ({
    label: l,
    slug: revealed ? answers[l].slug : null,
    content: answers[l].content,
    error: answers[l].error ?? false,
  }))

  return c.json({
    battle: {
      id: battle.id,
      prompt: battle.prompt,
      status: battle.status,
      created_at: battle.created_at,
      votes: totalVotes?.n ?? 0,
      viewer_voted: viewerVoted,
      revealed,
      columns,
    },
  })
})

// --------------------------------------------------------------- leaderboard

app.get('/api/arena', async (c) => {
  const [leaderboard, recentBattles] = await Promise.all([
    c.env.DB.prepare(
      `SELECT slug, label, elo_rating, elo_games, elo_wins, active,
              (SELECT COUNT(*) FROM freellm_model_providers p WHERE p.model_id = m.id AND p.active = 1) AS configs
       FROM freellm_models m WHERE active = 1
       ORDER BY elo_games > 0 DESC, elo_rating DESC, label`,
    ).all<{
      slug: string
      label: string
      elo_rating: number
      elo_games: number
      elo_wins: number
      active: number
      configs: number
    }>(),
    c.env.DB.prepare(
      `SELECT b.id, b.prompt, b.answers, b.created_at,
              (SELECT COUNT(*) FROM freellm_battle_votes v WHERE v.battle_id = b.id) AS votes
       FROM freellm_battles b WHERE b.status = 'complete' AND b.answers IS NOT NULL
       ORDER BY b.created_at DESC LIMIT 10`,
    ).all<{ id: string; prompt: string; answers: string; created_at: number; votes: number }>(),
  ])

  return c.json({
    leaderboard: leaderboard.results.map((row) => ({
      slug: row.slug,
      label: row.label,
      elo: row.elo_rating,
      games: row.elo_games,
      wins: row.elo_wins,
      win_rate: row.elo_games > 0 ? Math.round((row.elo_wins / row.elo_games) * 100) : null,
      configs: row.configs,
    })),
    recent_battles: recentBattles.results.map((battle) => {
      const answers = safeParse<Record<string, BattleAnswer>>(battle.answers) ?? {}
      return {
        id: battle.id,
        prompt: battle.prompt,
        created_at: battle.created_at,
        votes: battle.votes,
        columns: LABELS.filter((l) => answers[l]).map((l) => ({
          label: l,
          slug: answers[l].slug,
          preview: answers[l].content.slice(0, 240),
          error: answers[l].error ?? false,
        })),
      }
    }),
  })
})

function safeParse<T>(json: string | null): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

export default app
