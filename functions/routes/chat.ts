// Chat: the metered proxy.
//
// POST /api/chat  { model: slug, messages, request_id, max_tokens?, key_mode?, key_id? }
//   -> SSE stream. Passthrough deltas, then usage/settled events, [DONE].
//
// Flow: validate -> load alias -> reserve (hold) -> pick config by routing
// strategy -> stream upstream (failover on refusal) -> settle:
//   completed  provider-reported usage
//   aborted    flat rate (client disconnected before the usage chunk)
//   failed     no charge (upstream error)
//
// BYOK mode (key_mode=byok): free, direct, no reserve/hold/balance checks.

import { Hono } from 'hono'
import { requireAuth } from '../lib/middleware'
import { estimateReserve, computeSpendable, placeHold, settleRequest } from '../lib/metering'
import { callProvider, loadAlias, providerApiKey, recordOutcome, resolveCandidates, type UpstreamConfig, type ModelProviderRow, type UpstreamProviderWithModel } from '../lib/providers'
import { canAccessModel, tierGatedMessage } from '../lib/tiers'
import { decryptSecret } from '../lib/crypto'
import type { Bindings, ApiKeyRow, Variables } from '../lib/types'


const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

const encoder = new TextEncoder()
const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`

/** Extracts the usage block from an OpenAI-compatible SSE data line. */
function parseSseLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith('data:')) return null
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    return JSON.parse(payload) as Record<string, unknown>
  } catch {
    return null
  }
}

function usageFromChunk(chunk: Record<string, unknown>): { input: number; output: number; total: number } | null {
  const usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
  if (!usage) return null
  const input = usage.prompt_tokens
  const output = usage.completion_tokens
  const total = usage.total_tokens
  if (typeof input !== 'number' || typeof output !== 'number' || typeof total !== 'number') return null
  return { input, output, total }
}

// ------------------------------------------------------------- chat

app.post('/api/chat', requireAuth, async (c) => {
  const user = c.get('user')
  const payload = await c.req
    .json<{ model?: unknown; messages?: unknown; request_id?: unknown; max_tokens?: unknown; key_mode?: unknown; key_id?: unknown; required_capabilities?: unknown }>()
    .catch(() => null)

  const slug = typeof payload?.model === 'string' ? payload.model.trim() : ''
  const requestId = typeof payload?.request_id === 'string' ? payload.request_id : ''
  const rawMessages = Array.isArray(payload?.messages) ? payload.messages : []
  const keyMode = payload?.key_mode === 'byok' ? 'byok' : 'pool'
  const keyId = typeof payload?.key_id === 'string' ? payload.key_id : ''
  // required_capabilities: array of capability strings (e.g., ["tools", "vision"])
  const requiredCapabilities = Array.isArray(payload?.required_capabilities)
    ? payload.required_capabilities.filter((c): c is string => typeof c === 'string')
    : []

  const messages = rawMessages
    .filter(
      (m): m is { role: 'system' | 'user' | 'assistant'; content: string } =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as { role?: unknown }).role === 'string' &&
        typeof (m as { content?: unknown }).content === 'string',
    )
    .map((m) => ({ role: m.role, content: m.content }))

  if (!slug || messages.length === 0 || !/^[\w.-]{2,48}$/.test(requestId)) {
    return c.json({ error: 'invalid_input', message: 'model, messages, and a request_id are required.' }, 400)
  }
  if (messages.some((m) => m.content.length > 100_000)) {
    return c.json({ error: 'invalid_input', message: 'A single message is too long.' }, 400)
  }

  // Idempotency + alias load are independent: run them together so a
  // cache-cold request pays one round trip instead of two.
  const [priorEvent, alias] = await Promise.all([
    c.env.DB.prepare(
      'SELECT credits_charged, source, status FROM freellm_usage_events WHERE request_id = ? AND user_id = ?',
    )
      .bind(requestId, user.id)
      .first<{ credits_charged: number; source: string; status: string }>(),
    loadAlias(c.env, slug),
  ])
  if (priorEvent) {
    // Failed requests cost nothing — allow the same request_id to retry by
    // clearing the failed marker instead of dead-ending with 409.
    if (priorEvent.status === 'failed') {
      await c.env.DB.prepare('DELETE FROM freellm_usage_events WHERE request_id = ? AND user_id = ?')
        .bind(requestId, user.id)
        .run()
        .catch(() => {})
    } else {
      return c.json(
        {
          error: 'already_settled',
          message: 'This request was already billed.',
          credits_charged: priorEvent.credits_charged,
          retryable: false,
        },
        409,
      )
    }
  }

  if (!alias || alias.providers.length === 0) {
    return c.json({ error: 'model_unavailable', message: `"${slug}" is not in The Pool right now.` }, 404)
  }

  // Tier gate runs before any reserve/hold so a denied caller is never charged.
  if (!canAccessModel(user, alias.model)) {
    return c.json(
      { error: 'upgrade_required', message: tierGatedMessage(alias.model), required_tier: alias.model.access_tier },
      403,
    )
  }

  const maxTokens = Math.min(
    typeof payload?.max_tokens === 'number' && payload.max_tokens > 0
      ? Math.floor(payload.max_tokens)
      : alias.model.max_output_tokens,
    alias.model.max_output_tokens,
  )

  // ---- Step 1: Acquire the upstream call (BYOK or Pool) ----
  let call: Awaited<ReturnType<typeof callProvider>> | null = null
  let providerLabel = ''
  let startedAt = Date.now()
  let isByok = false
  // The winning Pool candidate (full row incl. upstream), set in the failover
  // loop so the success path can record health + impact. BYOK leaves it null
  // (recordOutcome is skipped for BYOK anyway).
  let selectedProvider: (ModelProviderRow & { upstream: UpstreamProviderWithModel }) | null = null

  const clientGone = () => c.req.raw.signal?.aborted === true

  if (keyMode === 'byok') {
    // --- BYOK path: single configured key, free, no reserve/hold ---
    if (!keyId) {
      return c.json({ error: 'invalid_input', message: 'key_id is required when key_mode=byok.' }, 400)
    }
    const row = await c.env.DB.prepare('SELECT * FROM freellm_api_keys WHERE id = ? AND user_id = ?')
      .bind(keyId, user.id)
      .first<ApiKeyRow>()
    if (!row) {
      return c.json({ error: 'not_found', message: 'Key not found or access denied.' }, 404)
    }
    if (row.active === 0) {
      return c.json({ error: 'key_disabled', message: 'This key is disabled.' }, 403)
    }

    const encryption = c.env.ENCRYPTION_KEY
    if (!encryption) {
      return c.json({ error: 'not_configured', message: 'ENCRYPTION_KEY is not set on this deployment.' }, 500)
    }
    const apiKey = await decryptSecret(row.key_ciphertext, row.key_iv, encryption)

    startedAt = Date.now()
    isByok = true
    providerLabel = row.label

    try {
      const candidate: UpstreamConfig = {
        id: `byok:${row.id}`,
        base_url: row.base_url,
        upstream_model: row.upstream_model,
      }
      call = await callProvider(candidate, apiKey, messages, { maxTokens, stream: true })
      if (!call.response.ok || !call.response.body) {
        const errText = (await call.response.text().catch(() => '')).slice(0, 300)
        await settleRequest(c.env.DB, {
          userId: user.id,
          requestId,
          model: alias.model,
          providerLabel: row.label,
          settlement: { kind: 'failed', reason: `${call.response.status} ${errText}` },
          latencyMs: Date.now() - startedAt,
          free: true,
        })
        return c.json({ error: 'upstream_failed', message: `Your key (${row.label}) returned ${call.response.status}: ${errText}` }, 502)
      }
    } catch (err) {
      await settleRequest(c.env.DB, {
        userId: user.id,
        requestId,
        model: alias.model,
        providerLabel: row.label,
        settlement: { kind: 'failed', reason: err instanceof Error ? err.message : 'network error' },
        latencyMs: Date.now() - startedAt,
        free: true,
      })
      return c.json({ error: 'upstream_failed', message: `Your key (${row.label}) is unreachable: ${err instanceof Error ? err.message : 'network error'}` }, 502)
    }
  } else {
    // --- Pool path: reserve, candidates, failover ---
    const reserve = estimateReserve(messages, maxTokens)
    const spendable = await computeSpendable(c.env.DB, user.id, user.balance_credits, alias.model.id, requestId)
    // Scoped-only aliases spend this alias's grant balance only — global
    // credits cannot buy into scarce provider capacity.
    if (alias.model.scoped_only === 1) {
      if (spendable.scoped < reserve || spendable.available < reserve) {
        const shortfall = reserve - Math.min(spendable.scoped, spendable.available)
        return c.json(
          {
            error: 'insufficient_scoped_credits',
            message: `${alias.model.label} spends ${alias.model.label} credits only — you have ${spendable.scoped.toLocaleString('en-US')} scoped. Redeem a promo code for this model.`,
            shortfall,
            scoped: spendable.scoped,
          },
          402,
        )
      }
    } else if (spendable.available < reserve) {
      const shortfall = reserve - spendable.available
      return c.json(
        {
          error: 'insufficient_credits',
          message: `This message needs about ${reserve.toLocaleString('en-US')} cr — you have ${spendable.available.toLocaleString('en-US')} spendable.`,
          shortfall,
        },
        402,
      )
    }
    // The hold write and the routing-counter read/write are independent:
    // overlap them so candidate selection costs no extra round trip.
    const [candidates] = await Promise.all([
      resolveCandidates(c.env, alias, Date.now(), { requiredCapabilities }),
      placeHold(c.env.DB, user.id, requestId, reserve),
    ])
    if (candidates.length === 0) {
      await settleRequest(c.env.DB, {
        userId: user.id,
        requestId,
        model: alias.model,
        providerLabel: 'none',
        settlement: { kind: 'failed', reason: 'no usable provider configs' },
        latencyMs: 0,
      })
      return c.json({ error: 'model_unavailable', message: 'All provider configs for this model are down.' }, 503)
    }

    startedAt = Date.now()
    let lastError = ''

    for (const candidate of candidates) {
      if (clientGone()) break
      const attemptStart = Date.now()
      try {
        const apiKey = await providerApiKey(c.env, candidate.upstream)
        call = await callProvider({ id: candidate.id, base_url: candidate.upstream.base_url, upstream_model: candidate.upstream_model }, apiKey, messages, { maxTokens, stream: true })
        if (call.response.ok && call.response.body) {
          providerLabel = candidate.upstream.label
          selectedProvider = candidate
          break
        }
        lastError = `${call.response.status} ${call.response.statusText}`
        const detail = (await call.response.text().catch(() => '')).slice(0, 200)
        await recordOutcome(c.env, candidate.upstream.id, candidate.id, { ok: false, latencyMs: Date.now() - attemptStart, error: `${lastError} ${detail}` })
        call = null
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'network error'
        await recordOutcome(c.env, candidate.upstream.id, candidate.id, { ok: false, latencyMs: Date.now() - attemptStart, error: lastError })
        call = null
      }
    }

    if (clientGone()) {
      await settleRequest(c.env.DB, {
        userId: user.id,
        requestId,
        model: alias.model,
        providerLabel: 'client-disconnect',
        settlement: { kind: 'aborted', reason: lastError || 'client disconnected' },
        latencyMs: Date.now() - startedAt,
      })
      return new Response(JSON.stringify({ error: 'client_closed', message: 'Request aborted by client.' }), {
        status: 499,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!call) {
      await settleRequest(c.env.DB, {
        userId: user.id,
        requestId,
        model: alias.model,
        providerLabel: 'all-configs-failed',
        settlement: { kind: 'failed', reason: lastError },
        latencyMs: Date.now() - startedAt,
      })
      return c.json(
        {
          error: 'upstream_failed',
          message: `${alias.model.label} is unavailable right now${lastError ? ` (upstream ${lastError})` : ''} — no charge. Try again shortly.`,
        },
        502,
      )
    }

  }

  // ---- Step 2: Shared streaming + settle ----
  // Both paths either return early or set `call` to a non-null upstream call,
  // but TS can't narrow a `let` across the if/else boundary — guard it once.
  if (!call) {
    return c.json({ error: 'upstream_failed', message: 'No upstream response.' }, 502)
  }
  // `call.response` is the streaming Response on both paths. `selectedProvider`
  // is the winning Pool candidate (with its upstream); it stays null on the
  // BYOK path, where health bookkeeping is skipped anyway.
  const provider = selectedProvider
  const upstream = call.response

  let usage: { input: number; output: number; total: number } | null = null
  let buffer = ''
  let settled = false
  const decoder = new TextDecoder()
  const streamStart = Date.now()

  const settle = async (kind: 'completed' | 'aborted' | 'failed', reason?: string): Promise<Awaited<ReturnType<typeof settleRequest>> | null> => {
    if (settled) return null
    settled = true
    // One retry: a D1 hiccup used to be swallowed and the flush event
    // below invented a flat-rate charge that never happened. Now the
    // client is told the truth — credits_charged null, status unknown —
    // rather than shown a receipt for tokens it got for free.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        // Health bookkeeping must never block or break billing: settle the
        // credits first-class, and record the outcome alongside it.
        const settlePromise = settleRequest(c.env.DB, {
          userId: user.id,
          requestId,
          model: alias.model,
          providerLabel,
          settlement: kind === 'completed' ? { kind, usage } : { kind, reason },
          latencyMs: Date.now() - startedAt,
          usage,
          free: isByok,
        })
        const outcomePromise =
          kind === 'completed' && !isByok && provider
            ? recordOutcome(c.env, provider.upstream.id, provider.id, { ok: true, latencyMs: Date.now() - streamStart }).catch((err) => {
                console.error('[chat] recordOutcome failed', requestId, err)
              })
            : Promise.resolve()
        const [result] = await Promise.all([settlePromise, outcomePromise])
        return result
      } catch (err) {
        console.error('[chat] settle failed (attempt %d)', attempt, requestId, err)
      }
    }
    return null
  }

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Strip upstream terminators — billing events are appended at flush
      // followed by a single [DONE], so generic clients see one terminator.
      const text = decoder.decode(chunk, { stream: true })
      const lines = (buffer + text).split('\n')
      buffer = lines.pop() ?? ''
      const passthrough: string[] = []
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed === 'data: [DONE]' || trimmed === '[DONE]') continue
        passthrough.push(line)
        // Parse every data line for usage — pretty-printed blocks span lines.
        if (!line.startsWith('data:') && !line.includes('"usage"')) continue
        const parsed = parseSseLine(trimmed.startsWith('data:') ? trimmed : line)
        if (!parsed) continue
        const found = usageFromChunk(parsed)
        if (found) usage = found
      }
      if (passthrough.length > 0) controller.enqueue(encoder.encode(passthrough.join('\n') + '\n'))
    },
    async flush(controller) {
      buffer += decoder.decode()
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          const parsed = parseSseLine(line.trim())
          if (!parsed) continue
          const found = usageFromChunk(parsed)
          if (found) usage = found
        }
      }
      buffer = ''
      let result: Awaited<ReturnType<typeof settleRequest>> | null = null
      try {
        result = await settle('completed', usage ? undefined : 'no usage block in stream')
      } catch (err) {
        console.error('[chat] settle failed in flush', requestId, err)
      }
      const status = result?.status ?? (usage ? 'completed' : 'aborted')
      controller.enqueue(
        encoder.encode(
          sse({
            type: 'usage',
            input: usage?.input ?? null,
            output: usage?.output ?? null,
            total: usage?.total ?? null,
            source: result?.source ?? 'flat_rate',
          }),
        ),
      )
      controller.enqueue(
        encoder.encode(
          sse({
            type: 'settled',
            // null (not flat_rate) when settlement genuinely failed — the
            // charge may land asynchronously; never report one that didn't.
            credits_charged: result?.creditsCharged ?? null,
            balance: result?.balance ?? { global: user.balance_credits, scoped: 0 },
            status: result ? status : 'unknown',
            model: alias.model.slug,
            provider: providerLabel,
            latency_ms: Date.now() - startedAt,
            request_id: requestId,
          }),
        ),
      )
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    },
    cancel() {
      void settle('aborted', 'client disconnected')
    },
  })

  const body = upstream.body
  if (!body) {
    await settle('failed', 'upstream returned no body')
    return c.json({ error: 'upstream_failed', message: 'Empty upstream response.' }, 502)
  }

  c.req.raw.signal?.addEventListener('abort', () => {
    void settle('aborted', 'client disconnected')
  })

  return new Response(body.pipeThrough(transform), {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  })
})

// ------------------------------------------------------------- models catalog

/**
 * Public catalog: every active alias with the shape the SPA (and API clients)
 * consume — slug, display fields, a status rolled up from the alias's active
 * provider configs, and the provider count. Deliberately NOT the provider
 * configs themselves: base_url / upstream_model are pool infrastructure,
 * not public data (admin gets those from /api/admin/models).
 */
app.get('/api/models', async (c) => {
  // Join model_providers -> upstream_providers -> upstream_models
  const rows = await c.env.DB.prepare(
    `SELECT m.slug, m.label, m.description, m.capabilities, m.context_window,
            m.max_output_tokens, m.flat_rate_credits, m.routing, m.access_tier, m.scoped_only,
            up.id AS up_id, up.label AS up_label, up.base_url,
            up.status AS provider_status, up.avg_latency_ms
     FROM freellm_models m
     LEFT JOIN freellm_model_providers mp ON mp.model_id = m.id AND mp.active = 1
     LEFT JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     WHERE m.active = 1
     ORDER BY m.sort_order, m.slug`,
  ).all<{
    slug: string
    label: string
    description: string | null
    capabilities: string
    context_window: number | null
    max_output_tokens: number
    flat_rate_credits: number
    routing: string
    access_tier: string
    scoped_only: number
    up_id: string | null
    up_label: string | null
    base_url: string | null
    provider_status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled' | null
    avg_latency_ms: number | null
  }>()

  type PublicModel = {
    slug: string
    label: string
    description: string | null
    capabilities: string[]
    context_window: number | null
    max_output_tokens: number
    flat_rate_credits: number
    routing: string
    access_tier: string
    scoped_only: number
    status: 'live' | 'slow' | 'down' | 'unknown'
    provider_count: number
  }

  const bySlug = new Map<string, PublicModel & { statuses: string[]; up_labels: string[] }>()
  for (const row of rows.results) {
    let entry = bySlug.get(row.slug)
    if (!entry) {
      entry = {
        slug: row.slug,
        label: row.label,
        description: row.description,
        capabilities: parseCapabilities(row.capabilities),
        context_window: row.context_window,
        max_output_tokens: row.max_output_tokens,
        flat_rate_credits: row.flat_rate_credits,
        routing: row.routing,
        access_tier: row.access_tier,
        scoped_only: row.scoped_only,
        status: 'unknown',
        provider_count: 0,
        statuses: [],
        up_labels: [],
      }
      bySlug.set(row.slug, entry)
    }
    if (row.provider_status && row.up_id) {
      entry.statuses.push(row.provider_status)
      entry.up_labels.push(row.up_label!)
    }
  }

  const models = Array.from(bySlug.values()).map(({ statuses, up_labels, ...model }) => ({
    ...model,
    provider_count: statuses.length,
    status: statuses.includes('live')
      ? ('live' as const)
      : statuses.includes('slow')
        ? ('slow' as const)
        : statuses.length > 0 && statuses.every((s) => s === 'down')
          ? ('down' as const)
          : ('unknown' as const),
  }))

  return c.json({ models })
})

/** `capabilities` is a JSON text column; tolerate junk rather than 500. */
function parseCapabilities(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

export default app