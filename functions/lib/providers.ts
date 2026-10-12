// Provider multiplexing: resolving a model alias to one of its upstream
// configs and calling it.
//
// Schema (post-migration 20241201120000):
//   freellm_models              — alias users chat with ("poolside-laguna")
//   freellm_upstream_providers  — real upstream provider (Poolside, OpenAI)
//   freellm_upstream_models     — canonical model names per provider
//   freellm_model_providers     — alias -> upstream_provider + upstream_model mapping
//
// An alias groups N model_provider rows. Each model_provider references
// one upstream_provider and one upstream_model. The alias's routing
// strategy picks among its model_providers:
//   round_robin      — rotating counter in KV, even spread
//   random           — uniform pick
//   failover         — priority order (lower first)
//   latency_weighted — epsilon-greedy: exploit lowest EWMA latency, explore
//                      via round-robin rotation with probability
//                      LATENCY_WEIGHTED_EXPLORATION_RATE so new/unknown
//                      configs still get traffic and EWMAs stay fresh
// Any strategy falls through to the next candidate when the upstream
// refuses the request (5xx/429), which is what makes a degraded pool
// survivable. A failed config then cools down before it can be selected again.
//
// Health/cooldown is now **shared at the upstream provider level**:
//   - If any config using Poolside fails, the upstream provider cools down
//   - EWMA latency is per-upstream-provider, so all aliases benefit
//   - API key stored once, decrypted per request

import { decryptSecret } from './crypto'
import type { Bindings, ModelProviderRow, ModelRow, UpstreamProviderRow, UpstreamProviderWithModel } from './types'
import { assertSafeBaseUrl } from './validate'

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

export type { ModelProviderRow, UpstreamProviderRow, UpstreamProviderWithModel }

const ROLLING_AVG_ALPHA = 0.3
const ROLLING_AVG_BETA = 0.7

export const EWMA_ALPHA = ROLLING_AVG_ALPHA
export const EWMA_BETA = ROLLING_AVG_BETA

/** Above this stream latency a healthy config is marked 'slow'. */
export const SLOW_THRESHOLD_MS = 8000

/** Default base cooldown after a failure; grows exponentially with consecutive failures. */
export const FAILED_PROVIDER_COOLDOWN_MS = 30 * 60 * 1000

/** Upper bound for exponential backoff. */
export const MAX_PROVIDER_COOLDOWN_MS = 4 * 60 * 60 * 1000

/** Absolute ceiling for a per-provider cooldown base (7 days). */
export const MAX_CONFIGURED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Cooldown after a failure: per-provider base doubled per consecutive
 * failure (30m,1h,2h shape), capped at 8x base and the 7-day ceiling.
 * With the default 30m base this reproduces the historic 30m→4h ladder.
 * Base 0 disables the cooldown (immediate retry).
 */
export function cooldownForAttempt(baseMs: number, failures: number): number {
  if (!(baseMs > 0)) return 0
  return Math.min(
    baseMs * 2 ** Math.min(Math.max(failures, 1) - 1, 3),
    baseMs * 8,
    MAX_CONFIGURED_COOLDOWN_MS,
  )
}

/** Per-attempt upstream timeout so a hung provider fails over instead of blocking. */
export const UPSTREAM_TIMEOUT_MS = 30_000

/**
 * Exploration probability for latency_weighted routing. With this
 * probability a request rotates round-robin across the rested pool
 * instead of exploiting the lowest EWMA — epsilon-greedy.
 */
export const LATENCY_WEIGHTED_EXPLORATION_RATE = 0.15

/** Alias with its resolved upstream providers (for routing). */
export type AliasWithProviders = {
  model: ModelRow
  providers: Array<ModelProviderRow & { upstream: UpstreamProviderWithModel }>
}

/** Minimal upstream config for callProvider (decrypted on demand). */
export type UpstreamConfig = {
  id: string
  base_url: string
  upstream_model: string
}

export async function loadAlias(env: Bindings, slug: string): Promise<AliasWithProviders | null> {
  const model = await env.DB.prepare('SELECT * FROM freellm_models WHERE slug = ? AND active = 1')
    .bind(slug)
    .first<ModelRow>()
  if (!model) return null

  // Join model_providers -> upstream_providers -> upstream_models in one query.
  const rows = await env.DB.prepare(
    `SELECT mp.*, 
            up.id AS up_id, up.label, up.base_url, up.api_key_ciphertext, up.api_key_iv,
            up.status, up.avg_latency_ms, up.consecutive_failures, up.cooldown_until,
            up.cooldown_base_ms, up.last_checked_at, up.last_error, 
            up.created_at AS up_created_at, up.updated_at AS up_updated_at,
            um.capabilities AS um_capabilities
     FROM freellm_model_providers mp
     JOIN freellm_upstream_providers up ON up.id = mp.upstream_provider_id
     LEFT JOIN freellm_upstream_models um
       ON um.upstream_provider_id = up.id AND um.upstream_model = mp.upstream_model
     WHERE mp.model_id = ? AND mp.active = 1
     ORDER BY mp.priority, up.label`
  ).bind(model.id).all<{
    id: string
    model_id: string
    upstream_provider_id: string
    upstream_model: string
    priority: number
    active: number
    messages_served: number
    created_at: number
    updated_at: number
    up_id: string
    label: string
    base_url: string
    api_key_ciphertext: string
    api_key_iv: string
    status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
    avg_latency_ms: number | null
    consecutive_failures: number
    cooldown_until: number | null
    cooldown_base_ms: number | null
    last_checked_at: number | null
    last_error: string | null
    up_created_at: number
    up_updated_at: number
    um_capabilities: string | null
  }>()

  const providers: Array<ModelProviderRow & { upstream: UpstreamProviderWithModel }> = rows.results.map((r) => ({
    id: r.id,
    model_id: r.model_id,
    upstream_provider_id: r.upstream_provider_id,
    upstream_model: r.upstream_model,
    priority: r.priority,
    active: r.active,
    messages_served: r.messages_served,
    created_at: r.created_at,
    updated_at: r.updated_at,
    upstream: {
      id: r.up_id,
      label: r.label,
      base_url: r.base_url,
      api_key_ciphertext: r.api_key_ciphertext,
      api_key_iv: r.api_key_iv,
      status: r.status,
      avg_latency_ms: r.avg_latency_ms,
      consecutive_failures: r.consecutive_failures,
      cooldown_until: r.cooldown_until,
      cooldown_base_ms: r.cooldown_base_ms,
      last_checked_at: r.last_checked_at,
      last_error: r.last_error,
      created_at: r.up_created_at,
      updated_at: r.up_updated_at,
      model_capabilities: parseCapabilities(r.um_capabilities),
    },
  }))

  return { model, providers }
}

/** Active configs ordered by the alias's routing strategy.
 *  Optionally filters to configs whose upstream model supports all required capabilities.
 */
export async function resolveCandidates(
  env: Bindings,
  alias: AliasWithProviders,
  now: number = Date.now(),
  opts: { random?: () => number; requiredCapabilities?: string[] } = {},
): Promise<Array<ModelProviderRow & { upstream: UpstreamProviderWithModel }>> {
  // Filter active + not disabled (upstream.status can also be 'disabled').
  let usable = alias.providers.filter(
    (p) => p.active !== 0 && p.upstream.status !== 'disabled',
  )
  if (usable.length === 0) return []

  // Capability-based filtering: keep only configs whose upstream model supports ALL required capabilities.
  if (opts.requiredCapabilities && opts.requiredCapabilities.length > 0) {
    const req = opts.requiredCapabilities
    usable = usable.filter((p) =>
      req.every((cap) => p.upstream.model_capabilities.includes(cap))
    )
    if (usable.length === 0) return []
  }

  // Cooldown is at the upstream provider level — if the shared provider is cooling,
  // none of its configs can be selected.
  const rested = usable.filter((p) => p.upstream.cooldown_until == null || p.upstream.cooldown_until <= now)
  if (rested.length === 0) return []

  // Prefer live/unknown, then slow, then down — degraded only when nothing better.
  const healthy = rested.filter((p) => p.upstream.status !== 'down')
  const fresh = healthy.filter((p) => p.upstream.status !== 'slow')
  const pool = fresh.length > 0 ? fresh : healthy.length > 0 ? healthy : rested

  // If capability filtering reduced the pool to zero, return empty (don't fall back).
  if (pool.length === 0) return []

  switch (alias.model.routing) {
    case 'random':
      return shuffle(pool)
    case 'failover':
      return [...pool].sort((a, b) => a.priority - b.priority)
    case 'latency_weighted': {
      const random = opts.random ?? Math.random
      if (random() < LATENCY_WEIGHTED_EXPLORATION_RATE) {
        // Explore: round-robin over the rested pool so unknown/slow configs
        // are still probed and EWMAs stay fresh.
        return rotateRoundRobin(env, alias.model.id, pool)
      }
      // Exploit: lowest upstream EWMA first, unknown (NULL) last, priority breaks ties.
      return sortByLatency(pool)
    }
    case 'round_robin':
    default: {
      return rotateRoundRobin(env, alias.model.id, pool)
    }
  }
}

/** Lowest upstream avg_latency_ms first; NULL (never measured) last. */
export function sortByLatency(
  pool: Array<ModelProviderRow & { upstream: UpstreamProviderWithModel }>
): Array<ModelProviderRow & { upstream: UpstreamProviderWithModel }> {
  return [...pool].sort((a, b) => {
    const la = a.upstream.avg_latency_ms ?? Number.MAX_SAFE_INTEGER
    const lb = b.upstream.avg_latency_ms ?? Number.MAX_SAFE_INTEGER
    if (la !== lb) return la - lb
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.upstream.id < b.upstream.id ? -1 : a.upstream.id > b.upstream.id ? 1 : 0
  })
}

/** KV counter per alias; a counter miss just falls back to a random order. */
async function rotateRoundRobin(
  env: Bindings,
  modelId: string,
  pool: Array<ModelProviderRow & { upstream: UpstreamProviderWithModel }>,
): Promise<Array<ModelProviderRow & { upstream: UpstreamProviderWithModel }>> {
  try {
    const key = `rr:${modelId}`
    const raw = await env.freellm_sessions.get(key)
    const next = (raw ? Number.parseInt(raw, 10) : 0) + 1
    await env.freellm_sessions.put(key, String(next), { expirationTtl: 86400 })
    const rotated = [...pool]
    const offset = next % rotated.length
    return [...rotated.slice(offset), ...rotated.slice(0, offset)]
  } catch {
    return shuffle(pool)
  }
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type UpstreamCall = {
  response: Response
  provider: UpstreamConfig
}

/**
 * Calls one config's /chat/completions. Returns the raw streaming Response;
 * the caller owns parsing and settlement. Aborts a hung upstream after
 * UPSTREAM_TIMEOUT_MS so failover can try the next candidate.
 */
export async function callProvider(
  provider: UpstreamConfig,
  apiKey: string,
  messages: ChatMessage[],
  options: {
    maxTokens: number
    stream: boolean
    sampling?: { temperature?: number; top_p?: number }
    timeoutMs?: number
    signal?: AbortSignal
  },
): Promise<UpstreamCall> {
  const base = provider.base_url.replace(/\/+$/, '')
  // SSRF guard at fetch time: the config-time check may be older than this
  // deployment (or the URL slipped in pre-guard) — never fetch a private host.
  assertSafeBaseUrl(base)
  const signal =
    options.signal ??
    (typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(options.timeoutMs ?? UPSTREAM_TIMEOUT_MS)
      : undefined)
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      model: provider.upstream_model,
      messages,
      max_tokens: options.maxTokens,
      stream: options.stream,
      // Ask OpenAI-compatible routers to include the usage block in the
      // final SSE chunk — that's our authoritative billing signal.
      ...(options.stream ? { stream_options: { include_usage: true } } : {}),
      // Forward sampling params verbatim when the caller sent them.
      ...(options.sampling?.temperature !== undefined ? { temperature: options.sampling.temperature } : {}),
      ...(options.sampling?.top_p !== undefined ? { top_p: options.sampling.top_p } : {}),
    }),
  })
  return { response, provider }
}

/** Records the outcome of a request against a config (health + impact). */
export async function recordOutcome(
  env: Bindings,
  providerId: string,                // upstream provider id
  modelProviderId: string,           // model_provider row id (for messages_served)
  outcome: { ok: boolean; latencyMs: number; error?: string },
): Promise<void> {
  if (outcome.ok) {
    // Update upstream provider health (shared across all aliases using it).
    await env.DB.prepare(
      `UPDATE freellm_upstream_providers
       SET status = ?, last_checked_at = ?, last_error = NULL, consecutive_failures = 0,
           cooldown_until = NULL,
           avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN ?
                                 ELSE CAST(avg_latency_ms * ? + ? * ? AS INTEGER) END,
           updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        outcome.latencyMs > SLOW_THRESHOLD_MS ? 'slow' : 'live',
        Date.now(),
        outcome.latencyMs,
        ROLLING_AVG_BETA,
        outcome.latencyMs,
        ROLLING_AVG_ALPHA,
        Date.now(),
        providerId,
      )
      .run()

    // Also bump messages_served on the specific model_provider row.
    await env.DB.prepare(
      `UPDATE freellm_model_providers
       SET messages_served = messages_served + 1, updated_at = ?
       WHERE id = ?`,
    )
      .bind(Date.now(), modelProviderId)
      .run()
  } else {
    // Exponential backoff on consecutive failures over the upstream provider's
    // own base TTL (or the global default when unset).
    const row = await env.DB.prepare(
      `SELECT consecutive_failures, cooldown_base_ms
       FROM freellm_upstream_providers WHERE id = ?`
    )
      .bind(providerId)
      .first<{ consecutive_failures: number; cooldown_base_ms: number | null }>()
    const failures = (row?.consecutive_failures ?? 0) + 1
    const base = row?.cooldown_base_ms ?? FAILED_PROVIDER_COOLDOWN_MS
    const backoff = cooldownForAttempt(base, failures)

    // Cool down the upstream provider — affects ALL configs using it.
    await env.DB.prepare(
      `UPDATE freellm_upstream_providers
       SET status = 'down', last_checked_at = ?, last_error = ?, consecutive_failures = ?,
           cooldown_until = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(Date.now(), outcome.error?.slice(0, 300) ?? 'unknown error', failures, Date.now() + backoff, Date.now(), providerId)
      .run()
  }
}

/** Decrypts an upstream provider's bearer for one request. */
export async function providerApiKey(env: Bindings, upstream: UpstreamProviderRow): Promise<string> {
  return decryptSecret(upstream.api_key_ciphertext, upstream.api_key_iv, env.ENCRYPTION_KEY)
}

/**
 * Opens a streaming chat call against an alias, walking its candidate configs
 * until one accepts the request (failover). Health is recorded per attempt.
 */
export async function openStreamingCall(
  env: Bindings,
  alias: AliasWithProviders,
  messages: ChatMessage[],
  options: { maxTokens: number; sampling?: { temperature?: number; top_p?: number }; requiredCapabilities?: string[] },
): Promise<{ provider: ModelProviderRow & { upstream: UpstreamProviderWithModel }; response: Response } | { error: string }> {
  const candidates = await resolveCandidates(env, alias, Date.now(), { requiredCapabilities: options.requiredCapabilities })
  if (candidates.length === 0) return { error: 'no usable provider configs' }

  let lastError = ''
  for (const candidate of candidates) {
    const startedAt = Date.now()
    try {
      const apiKey = await providerApiKey(env, candidate.upstream)
      const { response } = await callProvider(
        { id: candidate.id, base_url: candidate.upstream.base_url, upstream_model: candidate.upstream_model },
        apiKey,
        messages,
        { maxTokens: options.maxTokens, stream: true, sampling: options.sampling },
      )
      if (response.ok && response.body) return { provider: candidate, response }
      lastError = `${response.status} ${response.statusText}`
      const detail = (await response.text().catch(() => '')).slice(0, 200)
      await recordOutcome(env, candidate.upstream.id, candidate.id, {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: `${lastError} ${detail}`,
      })
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'network error'
      await recordOutcome(env, candidate.upstream.id, candidate.id, {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: lastError,
      })
    }
  }
  return { error: lastError || 'all configs failed' }
}