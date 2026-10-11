// The OpenAI-compatible surface — /v1.
//
//   GET  /v1/models              the catalog in OpenAI's shape (public)
//   POST /v1/chat/completions    chat through The Pool, billed 1:1 on tokens
//
// Auth: session cookie OR `Authorization: Bearer fl_…` (see routes/apikeys.ts).
// The wire contract is OpenAI's, so the OpenAI SDKs and every
// OpenAI-compatible tool work unchanged with:
//   new OpenAI({ baseURL: 'https://freellm.hasit.in/v1', apiKey: 'fl_…' })
//
// Billing reuses the pool metering path exactly — reserve, failover across
// provider configs, settle on provider-reported usage (flat rate as the
// fallback). BYOK stays on the native POST /api/chat.

import { Hono } from 'hono'
import { requireAuthOrToken } from '../lib/middleware'
import { computeSpendable, estimateReserve, placeHold, settleRequest, type Usage } from '../lib/metering'
import { loadAlias, openStreamingCall, recordOutcome } from '../lib/providers'
import { canAccessModel, tierGatedMessage } from '../lib/tiers'
import { newId } from '../lib/crypto'
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
  const rows = await c.env.DB.prepare(
    'SELECT slug, label, description, access_tier FROM freellm_models WHERE active = 1 ORDER BY sort_order, slug',
  ).all<{ slug: string; label: string; description: string | null; access_tier: string }>()

  return c.json({
    object: 'list',
    data: rows.results.map((row) => ({
      id: row.slug,
      object: 'model' as const,
      created: 0,
      owned_by: 'freellm',
      access_tier: row.access_tier,
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

  if (!slug || messages.length === 0) {
    return c.json(openAiBody('invalid_request_error', 'model and a non-empty messages array are required.'), 400)
  }
  if (messages.some((m) => m.content.length > 100_000)) {
    return c.json(openAiBody('invalid_request_error', 'A single message is too long.'), 400)
  }

  const stream = payload?.stream === true
  const includeUsage =
    stream && (payload?.stream_options as { include_usage?: unknown } | undefined)?.include_usage === true

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
  if (spendable.available < reserve) {
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
  const opened = await openStreamingCall(c.env, alias, messages, { maxTokens, sampling })
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

  const { provider, response } = opened
  const startedAt = Date.now()
  const completionId = `chatcmpl-${requestId.replace(/-/g, '').slice(0, 24)}`
  const created = Math.floor(Date.now() / 1000)

  const settle = async (kind: 'completed' | 'aborted' | 'failed', usage?: Usage | null, reason?: string) => {
    let result: Awaited<ReturnType<typeof settleRequest>> | null = null
    try {
      result = await settleRequest(c.env.DB, {
        userId: user.id,
        requestId,
        model: alias.model,
        providerLabel: provider.label,
        settlement: kind === 'completed' ? { kind, usage: usage ?? null } : { kind, reason },
        latencyMs: Date.now() - startedAt,
        usage,
      })
    } catch (err) {
      console.error('[v1] settleRequest failed', completionId, err)
    }
    // Health recording is best-effort: it must never turn an already-billed,
    // already-streamed completion into an error response.
    if (kind === 'completed') {
      try {
        await recordOutcome(c.env, provider.id, { ok: true, latencyMs: Date.now() - startedAt })
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
    let usage: Usage | null = null
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
        provider: provider.label,
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
      await settle('completed', usage)
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

export default app
