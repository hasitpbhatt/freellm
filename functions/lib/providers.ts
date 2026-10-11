// Provider multiplexing: resolving a model alias to one of its upstream
// configs and calling it.
//
// An alias (freellm_models row) groups N provider configs (freellm_model_providers rows).
// The alias's routing strategy picks among them:
//   round_robin      — rotating counter in KV, even spread
//   random           — uniform pick
//   failover         — priority order (lower first)
//   latency_weighted — epsilon-greedy: exploit lowest EWMA latency, explore
//                      via round-robin rotation with probability
//                      LATENCY_WEIGHTED_EXPLORATION_RATE so new/unknown
//                      configs still get traffic and EWMAs stay fresh
// Any strategy falls through to the next candidate when the upstream
// refuses the request (5xx/429), which is what makes a degraded pool
// survivable. A failed config then cools down for 30 minutes before it can
// be selected again.
//
// Minimal interface for any upstream caller — pool configs or BYOK keys.

import { decryptSecret } from './crypto'
import type { Bindings, ModelProviderRow, ModelRow } from './types'

const ROLLING_AVG_ALPHA = 0.3
const ROLLING_AVG_BETA = 0.7

export const EWMA_ALPHA = ROLLING_AVG_ALPHA
export const EWMA_BETA = ROLLING_AVG_BETA

/** Above this stream latency a healthy config is marked 'slow'. */
export const SLOW_THRESHOLD_MS = 8000

/** Base cooldown after a failure; grows exponentially with consecutive failures. */
export const FAILED_PROVIDER_COOLDOWN_MS = 30 * 60 * 1000

/** Upper bound for exponential backoff. */
export const MAX_PROVIDER_COOLDOWN_MS = 4 * 60 * 60 * 1000

/** Per-attempt upstream timeout so a hung provider fails over instead of blocking. */
export const UPSTREAM_TIMEOUT_MS = 30_000

/**
 * Exploration probability for latency_weighted routing. With this
 * probability a request rotates round-robin across the rested pool
 * instead of exploiting the lowest EWMA — epsilon-greedy.
 */
export const LATENCY_WEIGHTED_EXPLORATION_RATE = 0.15

export type UpstreamConfig = {
  id: string
  base_url: string
  upstream_model: string
}

export type AliasWithProviders = {
  model: ModelRow
  providers: ModelProviderRow[]
}

export async function loadAlias(env: Bindings, slug: string): Promise<AliasWithProviders | null> {
  const model = await env.DB.prepare('SELECT * FROM freellm_models WHERE slug = ? AND active = 1').bind(slug).first<ModelRow>()
  if (!model) return null
  const providers = await env.DB.prepare(
    'SELECT * FROM freellm_model_providers WHERE model_id = ? AND active = 1 ORDER BY priority, label',
  )
    .bind(model.id)
    .all<ModelProviderRow>()
  return { model, providers: providers.results }
}

/** Active configs ordered by the alias's routing strategy. */
export async function resolveCandidates(
  env: Bindings,
  alias: AliasWithProviders,
  now: number = Date.now(),
  opts: { random?: () => number } = {},
): Promise<ModelProviderRow[]> {
  // loadAlias filters active=1, but callers may pass rows directly —
  // belt-and-braces so a disabled config can never be selected.
  const usable = alias.providers.filter((p) => p.status !== 'disabled' && p.active !== 0)
  if (usable.length === 0) return []

  // Recently failed configs cool down before they can be selected again. If
  // every config is cooling down, fail without calling a known-bad upstream.
  const rested = usable.filter((p) => p.cooldown_until == null || p.cooldown_until <= now)
  if (rested.length === 0) return []

  // Prefer live/unknown, then slow, then down — a degraded config is only
  // used when nothing better is rested.
  const healthy = rested.filter((p) => p.status !== 'down')
  const fresh = healthy.filter((p) => p.status !== 'slow')
  const pool = fresh.length > 0 ? fresh : healthy.length > 0 ? healthy : rested

  switch (alias.model.routing) {
    case 'random':
      return shuffle(pool)
    case 'failover':
      return [...pool].sort((a, b) => a.priority - b.priority)
    case 'latency_weighted': {
      const random = opts.random ?? Math.random
      if (random() < LATENCY_WEIGHTED_EXPLORATION_RATE) {
        // Explore: round-robin rotation over the rested (non-cooldown) pool
        // so unknown/slow configs are still probed and EWMAs stay fresh.
        return rotateRoundRobin(env, alias.model.id, pool)
      }
      // Exploit: lowest EWMA first, unknown (NULL) last, priority breaks ties.
      return sortByLatency(pool)
    }
    case 'round_robin':
    default: {
      return rotateRoundRobin(env, alias.model.id, pool)
    }
  }
}

/** Lowest avg_latency_ms first; NULL (never measured) last. */
export function sortByLatency(pool: ModelProviderRow[]): ModelProviderRow[] {
  return [...pool].sort((a, b) => {
    const la = a.avg_latency_ms ?? Number.MAX_SAFE_INTEGER
    const lb = b.avg_latency_ms ?? Number.MAX_SAFE_INTEGER
    if (la !== lb) return la - lb
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
  })
}

/** KV counter per alias; a counter miss just falls back to a random order. */
async function rotateRoundRobin(
  env: Bindings,
  modelId: string,
  pool: ModelProviderRow[],
): Promise<ModelProviderRow[]> {
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
  const signal =
    options.signal ??
    (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(options.timeoutMs ?? UPSTREAM_TIMEOUT_MS) : undefined)
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
  providerId: string,
  outcome: { ok: boolean; latencyMs: number; error?: string },
): Promise<void> {
  if (outcome.ok) {
    await env.DB.prepare(
      `UPDATE freellm_model_providers
       SET status = ?, last_checked_at = ?, last_error = NULL, consecutive_failures = 0,
           cooldown_until = NULL,
           avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN ?
                                 ELSE CAST(avg_latency_ms * ? + ? * ? AS INTEGER) END,
           messages_served = messages_served + 1, updated_at = ?
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
  } else {
    // Exponential backoff on consecutive failures: 30m, 1h, 2h, 4h cap.
    // Read-then-write is fine here — worst case of a race is a shorter cooldown.
    const row = await env.DB.prepare('SELECT consecutive_failures FROM freellm_model_providers WHERE id = ?')
      .bind(providerId)
      .first<{ consecutive_failures: number }>()
    const failures = (row?.consecutive_failures ?? 0) + 1
    const backoff = Math.min(
      FAILED_PROVIDER_COOLDOWN_MS * 2 ** Math.min(failures - 1, 3),
      MAX_PROVIDER_COOLDOWN_MS,
    )
    await env.DB.prepare(
      `UPDATE freellm_model_providers
       SET status = 'down', last_checked_at = ?, last_error = ?, consecutive_failures = consecutive_failures + 1,
           cooldown_until = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(Date.now(), outcome.error?.slice(0, 300) ?? 'unknown error', Date.now() + backoff, Date.now(), providerId)
      .run()
  }
}

/** Decrypts a config's bearer for one request. */
export async function providerApiKey(env: Bindings, provider: ModelProviderRow): Promise<string> {
  return decryptSecret(provider.api_key_ciphertext, provider.api_key_iv, env.ENCRYPTION_KEY)
}

/**
 * Opens a streaming chat call against an alias, walking its candidate configs
 * until one accepts the request (failover). Health is recorded per attempt.
 */
export async function openStreamingCall(
  env: Bindings,
  alias: AliasWithProviders,
  messages: ChatMessage[],
  options: { maxTokens: number; sampling?: { temperature?: number; top_p?: number } },
): Promise<{ provider: ModelProviderRow; response: Response } | { error: string }> {
  const candidates = await resolveCandidates(env, alias)
  if (candidates.length === 0) return { error: 'no usable provider configs' }

  let lastError = ''
  for (const candidate of candidates) {
    const startedAt = Date.now()
    try {
      const apiKey = await providerApiKey(env, candidate)
      const { response } = await callProvider(candidate, apiKey, messages, {
        maxTokens: options.maxTokens,
        stream: true,
        sampling: options.sampling,
      })
      if (response.ok && response.body) return { provider: candidate, response }
      lastError = `${response.status} ${response.statusText}`
      const detail = (await response.text().catch(() => '')).slice(0, 200)
      await recordOutcome(env, candidate.id, { ok: false, latencyMs: Date.now() - startedAt, error: `${lastError} ${detail}` })
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'network error'
      await recordOutcome(env, candidate.id, { ok: false, latencyMs: Date.now() - startedAt, error: lastError })
    }
  }
  return { error: lastError || 'all configs failed' }
}
