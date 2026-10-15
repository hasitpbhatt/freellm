// The OpenAI-compatible surface — /v1.
//
//   GET  /v1/models              the catalog in OpenAI's shape (public)
//   POST /v1/chat/completions    chat through The Pool, billed 1:1 on tokens;
//                                or through your own vault credential with
//                                key_mode=byok + key_id (free, unmetered)
//
// Auth: session cookie OR `Authorization: Bearer fl_…` (see routes/apikeys.ts).
// The wire contract is OpenAI's, so the OpenAI SDKs and every
// OpenAI-compatible tool work unchanged with:
//   new OpenAI({ baseURL: 'https://freellm.hasit.in/v1', apiKey: 'fl_…' })
//
// Pool billing reuses the pool metering path exactly — reserve, failover
// across provider configs, settle on provider-reported usage (flat rate as
// the fallback). BYOK dials the caller's own vault row (api_key or oauth,
// one of possibly several personal accounts) and settles free with
// key_mode='byok' — it never touches The Pool or any shared credential.

import { Hono, type Context } from 'hono'
import { requireAuthOrToken } from '../lib/middleware'
import { computeSpendable, estimateReserve, placeHold, settleRequest, type Usage } from '../lib/metering'
import { loadAlias, openCall, recordOutcome } from '../lib/providers'
import { canAccessModel, tierGatedMessage } from '../lib/tiers'
import { newId, sha256Hex } from '../lib/crypto'
import { dialConnection, connectionSettleModel, getUsableConnection } from '../lib/connections'
import type { Bindings, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

type OpenAiMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** OpenAI's error envelope, so SDKs surface a useful message instead of "undefined". */
const openAiBody = (type: string, message: string, code: string | null = null) => ({ error: { message, type, code } })

/** Extracts a JSON payload from an OpenAI-compatible SSE data line. */
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

function usageFromChunk(chunk: Record<string, unknown>): Usage | null {
  const usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
  if (!usage) return null
  const { prompt_tokens: input, completion_tokens: output, total_tokens: total } = usage
  if (typeof input !== 'number' || typeof output !== 'number' || typeof total !== 'number') return null
  return { input, output, total }
}

// ------------------------------------------------------------- models list

app.get('/v1/models', async (c) => {
  // Join model_providers -> upstream_providers for provider status info
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT m.slug, m.label, m.description, m.access_tier, m.scoped_only, up.status AS up_status
     FROM freellm_models m
     LEFT JOIN freellm_model_providers mp ON mp.model_id = m.id AND mp.active = 1
     LEFT JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     WHERE m.active = 1
     ORDER BY m.sort_order, m.slug`,
  ).all<{ slug: string; label: string; description: string | null; access_tier: string; scoped_only: number; up_status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled' | null }>()

  return c.json({
    object: 'list',
    data: rows.results.map((row) => ({
      id: row.slug,
      object: 'model' as const,
      created: 0,
      owned_by: 'freellm',
      access_tier: row.access_tier,
      scoped_only: row.scoped_only,
      ...(row.description ? { description: row.description } : {}),
    })),
  })
})

// ------------------------------------------------------------- chat completions

app.post('/v1/chat/completions', requireAuthOrToken, async (c) => {
  const user = c.get('user')
  const payload = await c.req
    .json<{
      model?: unknown
      messages?: unknown
      max_tokens?: unknown
      max_completion_tokens?: unknown
      stream?: unknown
      stream_options?: unknown
      temperature?: unknown
      top_p?: unknown
      required_capabilities?: unknown
      key_mode?: unknown
      key_id?: unknown
      connection_id?: unknown
    }>()
    .catch(() => null)

  const slug = typeof payload?.model === 'string' ? payload.model.trim() : ''
  const rawMessages = Array.isArray(payload?.messages) ? payload.messages : []
  const messages = rawMessages
    .filter(
      (m): m is OpenAiMessage =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as { role?: unknown }).role === 'string' &&
        typeof (m as { content?: unknown }).content === 'string' &&
        ['system', 'user', 'assistant'].includes((m as { role: string }).role),
    )
    .map((m) => ({ role: m.role, content: m.content }))
  // required_capabilities: array of capability strings (e.g., ["tools", "vision"])
  const requiredCapabilities = Array.isArray(payload?.required_capabilities)
    ? payload.required_capabilities.filter((c): c is string => typeof c === 'string')
    : []

  if (!slug || messages.length === 0) {
    return c.json(openAiBody('invalid_request_error', 'model and a non-empty messages array are required.'), 400)
  }
  if (messages.some((m) => m.content.length > 100_000)) {
    return c.json(openAiBody('invalid_request_error', 'A single message is too long.'), 400)
  }

  const stream = payload?.stream === true
  const includeUsage =
    stream && (payload?.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true

  // ---- Connection: the caller's own credential, selected without magic ----
  // Precedence: an explicit body field (connection_id, or the legacy
  // key_mode=byok + key_id) over the connection this API token is bound to.
  const auth = c.req.header('Authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const bodyConnectionId =
    typeof payload?.connection_id === 'string' && payload.connection_id
      ? payload.connection_id
      : payload?.key_mode === 'byok' && typeof payload?.key_id === 'string'
        ? payload.key_id
        : ''
  const connectionId = bodyConnectionId || (bearer ? ((await connectionIdForToken(c.env, bearer)) ?? '') : '')

  const requestedMax =
    typeof payload?.max_tokens === 'number' && payload.max_tokens > 0
      ? Math.floor(payload.max_tokens)
      : typeof payload?.max_completion_tokens === 'number' && payload.max_completion_tokens > 0
        ? Math.floor(payload.max_completion_tokens)
        : 8192

  if (connectionId) {
    return chatWithConnection(c, {
      user,
      messages,
      upstreamModel: slug,
      maxTokens: requestedMax,
      stream,
      includeUsage,
      connectionId,
    })
  }

  // ---- Pool: resolve the alias, reserve, failover ----
  const alias = await loadAlias(c.env, slug)
  if (!alias || alias.providers.length === 0) {
    return c.json(
      openAiBody('invalid_request_error', `"${slug}" is not in The Pool. Browse GET /v1/models.`, 'model_not_found'),
      404,
    )
  }

  // Tier gate runs before any reserve/hold so a denied caller is never charged.
  if (!canAccessModel(user, alias.model)) {
    return c.json(
      openAiBody('invalid_request_error', tierGatedMessage(alias.model), 'upgrade_required'),
      403,
    )
  }

  const maxTokens = Math.min(
    typeof payload?.max_tokens === 'number' && payload.max_tokens > 0
      ? Math.floor(payload.max_tokens)
      : typeof payload?.max_completion_tokens === 'number' && payload.max_completion_tokens > 0
        ? Math.floor(payload.max_completion_tokens)
        : alias.model.max_output_tokens,
    alias.model.max_output_tokens,
  )

  // Sampling params are forwarded verbatim when present — silently dropping
  // them would make the surface lie about what it honours.
  const sampling = {
    temperature: typeof payload?.temperature === 'number' ? payload.temperature : undefined,
    top_p: typeof payload?.top_p === 'number' ? payload.top_p : undefined,
  }

  // ---- reserve ----
  const requestId = newId()
  const reserve = estimateReserve(messages, maxTokens)
  const spendable = await computeSpendable(c.env.DB, user.id, user.balance_credits, alias.model.id, requestId)
  // Scoped-only aliases spend this alias's grant balance only — global
  // credits cannot buy into scarce provider capacity.
  if (alias.model.scoped_only === 1) {
    if (spendable.scoped < reserve || spendable.available < reserve) {
      return c.json(
        openAiBody(
          'billing_error',
          `${alias.model.label} spends ${alias.model.label} credits only — you have ${spendable.scoped.toLocaleString('en-US')} scoped. Redeem a promo code for this model.`,
          'insufficient_scoped_credits',
        ),
        402,
      )
    }
  } else if (spendable.available < reserve) {
    return c.json(
      openAiBody(
        'billing_error',
        `This request needs about ${reserve.toLocaleString('en-US')} credits — you have ${spendable.available.toLocaleString('en-US')} spendable. Earn more at https://freellm.hasit.in/earn.`,
        'insufficient_credits',
      ),
      402,
    )
  }
  await placeHold(c.env.DB, user.id, requestId, reserve)

  // ---- acquire (failover across provider configs) ----
  const opened = await openCall(c.env, alias, messages, { maxTokens, sampling, requiredCapabilities })
  if ('error' in opened) {
    await settleRequest(c.env.DB, {
      userId: user.id,
      requestId,
      model: alias.model,
      providerLabel: 'all-configs-failed',
      settlement: { kind: 'failed', reason: opened.error },
      latencyMs: 0,
    })
    return c.json(
      openAiBody('server_error', `${alias.model.label} is unavailable right now — no charge.`, 'upstream_failed'),
      502,
    )
  }

  const { provider, key, response, usage: preUsage, streaming } = opened
  const startedAt = Date.now()
  const completionId = `chatcmpl-${requestId.replace(/-/g, '').slice(0, 24)}`
  const created = Math.floor(Date.now() / 1000)

  const settle = async (kind: 'completed' | 'aborted' | 'failed', usage?: Usage | null, reason?: string) => {
    let result: Awaited<ReturnType<typeof settleRequest>> | null = null
    // One retry before giving up: a D1 hiccup must not turn an
    // already-streamed completion into a silent free one with no usage
    // event and no ledger row.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = await settleRequest(c.env.DB, {
          userId: user.id,
          requestId,
          model: alias.model,
          providerLabel: provider.upstream.label,
          settlement: kind === 'completed' ? { kind, usage: usage ?? preUsage ?? null } : { kind, reason },
          latencyMs: Date.now() - startedAt,
          usage: usage ?? preUsage ?? null,
        })
        break
      } catch (err) {
        console.error('[v1] settleRequest failed (attempt %d)', attempt, completionId, err)
      }
    }
    // Health recording is best-effort: it must never turn an already-billed,
    // already-streamed completion into an error response.
    if (kind === 'completed') {
      try {
        await recordOutcome(c.env, provider.upstream.id, provider.id, { ok: true, latencyMs: Date.now() - startedAt, keyId: key.id })
      } catch (err) {
        console.error('[v1] recordOutcome failed', completionId, err)
      }
    }
    return result
  }

  const baseChunk = {
    id: completionId,
    object: 'chat.completion.chunk' as const,
    created,
    model: alias.model.slug,
  }
  const sse = (choices: unknown[], extra: Record<string, unknown> = {}) =>
    `data: ${JSON.stringify({ ...baseChunk, choices, ...extra })}\n\n`

  // ---- non-streaming: aggregate the upstream stream into one completion ----
  if (!stream) {
    let content = ''
    let finishReason: string | null = null
    let usage: Usage | null = preUsage ?? null

    if (streaming) {
      // Upstream returned a streaming response (SSE), parse it
      try {
        const text = await response.text()
        for (const line of text.split('\n')) {
          const parsed = parseSseLine(line)
          if (!parsed) continue
          usage = usageFromChunk(parsed) ?? usage
          const choice = (parsed.choices as Array<{ delta?: { content?: unknown }; finish_reason?: unknown }> | undefined)?.[0]
          if (typeof choice?.delta?.content === 'string') content += choice.delta.content
          if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason
        }
      } catch (err) {
        await settle('failed', null, err instanceof Error ? err.message : 'upstream stream failed')
        return c.json(openAiBody('server_error', 'The upstream stream failed — no charge was made.', 'upstream_failed'), 502)
      }
    } else {
      // Upstream returned a non-streaming JSON response - parse it directly
      try {
        const data = (await response.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>
        const choices = data.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined
        const choice = choices?.[0]
        if (choice?.message?.content) content = choice.message.content
        if (choice?.finish_reason) finishReason = choice.finish_reason
        // usage is already in preUsage from openCall
        usage = preUsage ?? null
      } catch (err) {
        await settle('failed', null, err instanceof Error ? err.message : 'upstream response failed')
        return c.json(openAiBody('server_error', 'The upstream response failed — no charge was made.', 'upstream_failed'), 502)
      }
    }

    const result = await settle('completed', usage)
    return c.json({
      id: completionId,
      object: 'chat.completion',
      created,
      model: alias.model.slug,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason ?? 'stop' }],
      usage: usage
        ? { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.total }
        : undefined,
      freellm: {
        request_id: requestId,
        credits_charged: result ? result.creditsCharged : null,
        billed_source: result?.source ?? null,
        provider: provider.upstream.label,
      },
    })
  }

  // ---- streaming: reshape upstream chunks into OpenAI chunks ----
  const body = response.body
  if (!body) {
    await settle('failed', null, 'upstream returned no body')
    return c.json(openAiBody('server_error', 'Empty upstream response.', 'upstream_failed'), 502)
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let usage: Usage | null = null
  let roleSent = false
  let finishReason: string | null = null
  let settled = false

  const flushChunks = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!roleSent) {
      // Upstream closed without a single choice — still emit a well-formed completion.
      controller.enqueue(encoder.encode(sse([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }])))
    }
    controller.enqueue(
      encoder.encode(
        sse([{ index: 0, delta: {}, finish_reason: finishReason ?? 'stop' }], includeUsage ? {} : usage ? { usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.total } } : {}),
      ),
    )
    if (includeUsage) {
      // OpenAI's include_usage convention: a trailing chunk with empty choices.
      controller.enqueue(
        encoder.encode(
          sse(
            [],
            {
              usage: usage
                ? { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.total }
                : null,
            },
          ),
        ),
      )
    }
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
  }

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const parsed = parseSseLine(line)
        if (!parsed) continue
        usage = usageFromChunk(parsed) ?? usage
        const choice = (
          parsed.choices as Array<{ delta?: { role?: unknown; content?: unknown }; finish_reason?: unknown }> | undefined
        )?.[0]
        if (!choice) continue

        if (!roleSent && (typeof choice.delta?.role === 'string' || typeof choice.delta?.content === 'string')) {
          roleSent = true
          controller.enqueue(
            encoder.encode(sse([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }])),
          )
        }
        if (typeof choice.delta?.content === 'string' && choice.delta.content.length > 0) {
          controller.enqueue(
            encoder.encode(sse([{ index: 0, delta: { content: choice.delta.content }, finish_reason: null }])),
          )
        }
        if (typeof choice.finish_reason === 'string' && finishReason === null) {
          finishReason = choice.finish_reason
        }
      }
    },
    async flush(controller) {
      if (settled) return
      settled = true
      try {
        await settle('completed', usage)
      } catch (err) {
        console.error('[v1] settle failed in flush', completionId, err)
      }
      flushChunks(controller)
    },
    cancel() {
      if (settled) return
      settled = true
      void settle('aborted', usage, 'client disconnected')
    },
  })

  return new Response(body.pipeThrough(transform), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Freellm-Completion-Id': completionId,
    },
  })
})

// ------------------------------------------------------- connection completions
// Dials the caller's own connection (a personal api_key/oauth account, or a
// shared one) instead of The Pool. No reserve, no hold, no charge — the usage
// event records key_mode='byok' for attribution only.

/** The connection an API token is bound to, if any (the no-magic-param path). */
async function connectionIdForToken(env: Bindings, bearer: string): Promise<string | null> {
  if (!bearer) return null
  const rec = await env.DB.prepare('SELECT connection_id FROM freellm_api_tokens WHERE token_hash = ?')
    .bind(await sha256Hex(bearer))
    .first<{ connection_id: string | null }>()
  return rec?.connection_id ?? null
}

/** A free, zero-cost model row so connection usage has something to attribute to. */
// Dials the caller's own connection (personal or shared), free and unmetered.
// `upstreamModel` is the request's `model` field, passed straight through — the
// wire contract stays plain OpenAI: no key_mode, no key_id.
async function chatWithConnection(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  opts: {
    user: { id: string; balance_credits: number }
    messages: OpenAiMessage[]
    upstreamModel: string
    maxTokens: number
    stream: boolean
    includeUsage: boolean
    connectionId: string
  },
): Promise<Response> {
  const { user, messages, upstreamModel, maxTokens, stream, includeUsage, connectionId } = opts
  const conn = await getUsableConnection(c.env, user.id, connectionId)
  if (!conn) {
    return c.json(openAiBody('invalid_request_error', 'Connection not found or access denied.', 'connection_not_found'), 404)
  }

  const requestId = newId()
  const startedAt = Date.now()
  const completionId = `chatcmpl-${requestId.replace(/-/g, '').slice(0, 24)}`
  const created = Math.floor(Date.now() / 1000)
  const isCodex = conn.protocol === 'codex'
  const settleModel = connectionSettleModel(conn.id, upstreamModel)

  let upstream: Response
  try {
    upstream = await dialConnection(c, conn, { messages, upstreamModel, maxTokens, stream })
  } catch (err) {
    await settleRequest(c.env.DB, {
      userId: user.id,
      requestId,
      model: settleModel,
      providerLabel: conn.label,
      settlement: { kind: 'failed', reason: err instanceof Error ? err.message : 'network error' },
      latencyMs: Date.now() - startedAt,
      free: true,
    })
    return c.json(
      openAiBody('server_error', `${conn.label} is unreachable: ${err instanceof Error ? err.message : 'network error'}`, 'upstream_failed'),
      502,
    )
  }
  if (!upstream.ok) {
    const errText = (await upstream.text().catch(() => '')).slice(0, 300)
    await settleRequest(c.env.DB, {
      userId: user.id,
      requestId,
      model: settleModel,
      providerLabel: conn.label,
      settlement: { kind: 'failed', reason: `${upstream.status} ${errText}` },
      latencyMs: Date.now() - startedAt,
      free: true,
    })
    return c.json(
      openAiBody('server_error', `${conn.label} returned ${upstream.status}: ${errText}`, 'upstream_failed'),
      502,
    )
  }

  const settle = async (kind: 'completed' | 'aborted' | 'failed', usage?: Usage | null, reason?: string) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await settleRequest(c.env.DB, {
          userId: user.id,
          requestId,
          model: settleModel,
          providerLabel: conn.label,
          settlement: kind === 'completed' ? { kind, usage: usage ?? null } : { kind, reason },
          latencyMs: Date.now() - startedAt,
          usage: usage ?? null,
          free: true,
        })
      } catch (err) {
        console.error('[v1:connection] settleRequest failed (attempt %d)', attempt, completionId, err)
      }
    }
    return null
  }

  const baseChunk = {
    id: completionId,
    object: 'chat.completion.chunk' as const,
    created,
    model: upstreamModel,
  }
  const sse = (choices: unknown[], extra: Record<string, unknown> = {}) =>
    `data: ${JSON.stringify({ ...baseChunk, choices, ...extra })}\n\n`

  // ---- non-streaming: aggregate the upstream body into one completion ----
  if (!stream) {
    let content = ''
    let finishReason: string | null = null
    let usage: Usage | null = null
    try {
      if (isCodex) {
        // Translated OpenAI SSE — same aggregation as the pool path.
        const text = await upstream.text()
        for (const line of text.split('\n')) {
          const parsed = parseSseLine(line)
          if (!parsed) continue
          usage = usageFromChunk(parsed) ?? usage
          const choice = (parsed.choices as Array<{ delta?: { content?: unknown }; finish_reason?: unknown }> | undefined)?.[0]
          if (typeof choice?.delta?.content === 'string') content += choice.delta.content
          if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason
        }
      } else {
        const data = (await upstream.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>
        const choices = data.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined
        const choice = choices?.[0]
        if (choice?.message?.content) content = choice.message.content
        if (choice?.finish_reason) finishReason = choice.finish_reason
        const u = data.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
        if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number' && typeof u.total_tokens === 'number') {
          usage = { input: u.prompt_tokens, output: u.completion_tokens, total: u.total_tokens }
        }
      }
    } catch (err) {
      await settle('failed', null, err instanceof Error ? err.message : 'upstream response failed')
      return c.json(openAiBody('server_error', 'The upstream response failed — no charge was made.', 'upstream_failed'), 502)
    }
    const result = await settle('completed', usage)
    return c.json({
      id: completionId,
      object: 'chat.completion',
      created,
      model: upstreamModel,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason ?? 'stop' }],
      usage: usage
        ? { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.total }
        : undefined,
      freellm: {
        request_id: requestId,
        key_mode: 'byok',
        credits_charged: result ? result.creditsCharged : null,
        billed_source: result?.source ?? null,
        provider: conn.label,
      },
    })
  }

  // ---- streaming: pass upstream chunks through, capture usage ----
  const body = upstream.body
  if (!body) {
    await settle('failed', null, 'upstream returned no body')
    return c.json(openAiBody('server_error', 'Empty upstream response.', 'upstream_failed'), 502)
  }

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let usage: Usage | null = null
  let roleSent = false
  let finishReason: string | null = null
  let settled = false

  const flushChunks = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!roleSent) {
      controller.enqueue(encoder.encode(sse([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }])))
    }
    controller.enqueue(
      encoder.encode(
        sse([{ index: 0, delta: {}, finish_reason: finishReason ?? 'stop' }], includeUsage ? {} : usage ? { usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.total } } : {}),
      ),
    )
    if (includeUsage) {
      controller.enqueue(
        encoder.encode(
          sse([], { usage: usage ? { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.total } : null }),
        ),
      )
    }
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
  }

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const parsed = parseSseLine(line)
        if (!parsed) continue
        usage = usageFromChunk(parsed) ?? usage
        const choice = (
          parsed.choices as Array<{ delta?: { role?: unknown; content?: unknown }; finish_reason?: unknown }> | undefined
        )?.[0]
        if (!choice) continue

        if (!roleSent && (typeof choice.delta?.role === 'string' || typeof choice.delta?.content === 'string')) {
          roleSent = true
          controller.enqueue(
            encoder.encode(sse([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }])),
          )
        }
        if (typeof choice.delta?.content === 'string' && choice.delta.content.length > 0) {
          controller.enqueue(
            encoder.encode(sse([{ index: 0, delta: { content: choice.delta.content }, finish_reason: null }])),
          )
        }
        if (typeof choice.finish_reason === 'string' && finishReason === null) {
          finishReason = choice.finish_reason
        }
      }
    },
    async flush(controller) {
      if (settled) return
      settled = true
      try {
        await settle('completed', usage)
      } catch (err) {
        console.error('[v1:connection] settle failed in flush', completionId, err)
      }
      flushChunks(controller)
    },
    cancel() {
      if (settled) return
      settled = true
      void settle('aborted', usage, 'client disconnected')
    },
  })

  return new Response(body.pipeThrough(transform), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Freellm-Completion-Id': completionId,
    },
  })
}

export default app
