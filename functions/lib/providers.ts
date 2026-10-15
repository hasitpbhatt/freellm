// Provider multiplexing: resolving a model alias to one of its upstream
// configs and calling it.
//
// Schema (post-0027):
//   freellm_models              — alias users chat with ("poolside-laguna")
//   freellm_upstream_providers  — one endpoint (base_url): label, health rollup
//   freellm_upstream_keys       — N bearer keys per endpoint, each with its own
//                                 health/cooldown (a 429 cools one key, not the
//                                 whole endpoint)
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
// Health is layered:
//   - A 429 (quota exhausted) cools down the specific *key* that was used, so
//     the endpoint's other keys keep serving.
//   - Any other failure (5xx, network) cools down the *provider* — all keys
//     share the endpoint, so a dead endpoint is a dead endpoint.
//   - Endpoint-level EWMA latency and status remain a rollup across all keys.
//
// API key selection within a provider: least-recently-used usable key (a
// disabled or cooling key is skipped). `last_used_at` is refreshed at selection
// time so concurrent traffic spreads across keys.

import { decryptSecret } from './crypto'
import type { Bindings, ModelProviderRow, ModelRow, UpstreamKeyRow, UpstreamProviderRow, UpstreamProviderWithModel } from './types'
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
            up.id AS up_id, up.label, up.base_url,
            up.status, up.avg_latency_ms, up.consecutive_failures, up.cooldown_until,
            up.cooldown_base_ms, up.last_checked_at, up.last_error, 
            up.created_at AS up_created_at, up.updated_at AS up_updated_at,
            um.capabilities AS um_capabilities,
            um.supports_streaming AS um_supports_streaming
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
    um_supports_streaming: number | null
  }>()

  // Load the key pool for the distinct upstream providers in one query.
  const upstreamIds = [...new Set(rows.results.map((r) => r.up_id))]
  const keyRows = upstreamIds.length
    ? (
        await env.DB.prepare(
          `SELECT * FROM freellm_upstream_keys
           WHERE upstream_provider_id IN (${upstreamIds.map(() => '?').join(',')})
           ORDER BY priority ASC, COALESCE(last_used_at, 0) ASC`,
        )
          .bind(...upstreamIds)
          .all<UpstreamKeyRow>()
      ).results
    : []
  const keysByProvider = new Map<string, UpstreamKeyRow[]>()
  for (const key of keyRows) {
    const list = keysByProvider.get(key.upstream_provider_id) ?? []
    list.push(key)
    keysByProvider.set(key.upstream_provider_id, list)
  }

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
      keys: keysByProvider.get(r.up_id) ?? [],
      supports_streaming: r.um_supports_streaming ?? 1,
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
  // none of its configs can be selected. Providers with no usable key are
  // dropped too (a fully-cooled key pool can't serve).
  const rested = usable.filter(
    (p) =>
      (p.upstream.cooldown_until == null || p.upstream.cooldown_until <= now) &&
      selectProviderKey(p.upstream.keys, now) !== null,
  )
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

/**
 * Picks a usable key from an upstream provider's pool: not disabled, not
 * cooling, then least-recently-used (priority breaks ties) so traffic spreads.
 * Returns null when every key is disabled or cooling.
 *
 * `'unknown'` is the default state of a fresh key (and of every key the
 * 0025/0027 backfills copied from a never-probed provider) — it MUST be
 * selectable, otherwise a key can never be tried, can never be probed, and
 * can never be promoted to 'live': the pool could not bootstrap and every
 * model would report "no usable keys". What we exclude is the negative
 * states — disabled by the operator, and 'down' unless nothing better exists.
 */
export function selectProviderKey(keys: UpstreamKeyRow[], now: number): UpstreamKeyRow | null {
  const usable = keys.filter(
    (k) => k.status !== 'disabled' && (k.cooldown_until == null || k.cooldown_until <= now),
  )
  if (usable.length === 0) return null
  // A key marked down by the infrastructure-failure path carries no cooldown,
  // so it is a last resort only — never chosen while a fresh key exists.
  const preferred = usable.filter((k) => k.status !== 'down')
  const pool = preferred.length > 0 ? preferred : usable
  return [...pool].sort(
    (a, b) => a.priority - b.priority || (a.last_used_at ?? 0) - (b.last_used_at ?? 0),
  )[0]
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
    headers?: Record<string, string>
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
      // Caller extras first: the built-in Content-Type and Authorization
      // below always win, so a future caller can't hijack auth by accident.
      ...(options.headers ?? {}),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      model: provider.upstream_model,
      messages,
      max_tokens: options.maxTokens,
      stream: options.stream,
      // Ask [OI]-compatible routers to include the usage block in the
      // final SSE chunk — that's our authoritative billing signal.
      ...(options.stream ? { stream_options: { include_usage: true } } : {}),
      // Forward sampling params verbatim when the caller sent them.
      ...(options.sampling?.temperature !== undefined ? { temperature: options.sampling.temperature } : {}),
      ...(options.sampling?.top_p !== undefined ? { top_p: options.sampling.top_p } : {}),
    }),
  })
  return { response, provider }
}

/**
 * Non-streaming version: calls /chat/completions with stream=false and
 * parses the JSON response for usage. Used as a fallback when streaming
 * is not supported by the upstream model.
 */
export async function callProviderNonStreaming(
  provider: UpstreamConfig,
  apiKey: string,
  messages: ChatMessage[],
  options: {
    maxTokens: number
    sampling?: { temperature?: number; top_p?: number }
    timeoutMs?: number
    signal?: AbortSignal
  },
): Promise<{
  response: Response
  provider: UpstreamConfig
  usage: { input: number; output: number; total: number } | null
}> {
  const base = provider.base_url.replace(/\/+$/, '')
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
      stream: false,
      ...(options.sampling?.temperature !== undefined ? { temperature: options.sampling.temperature } : {}),
      ...(options.sampling?.top_p !== undefined ? { top_p: options.sampling.top_p } : {}),
    }),
  })

  let usage: { input: number; output: number; total: number } | null = null
  if (response.ok) {
    const data = (await response.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>
    const u = data.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined
    if (u && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number' && typeof u.total_tokens === 'number') {
      usage = { input: u.prompt_tokens, output: u.completion_tokens, total: u.total_tokens }
    }
  }

  return { response, provider, usage }
}

/**
 * Selects the least-used usable key from an upstream provider's pool and
 * decrypts its bearer. Returns null when the provider has no usable key.
 * Marks the key as used (best-effort) so concurrent traffic spreads.
 */
export async function providerApiKey(
  env: Bindings,
  upstream: UpstreamProviderWithModel,
  now: number = Date.now(),
): Promise<{ key: UpstreamKeyRow; apiKey: string } | null> {
  const key = selectProviderKey(upstream.keys, now)
  if (!key) return null
  const apiKey = await decryptSecret(key.api_key_ciphertext, key.api_key_iv, env.ENCRYPTION_KEY)
  // Best-effort freshness marker; a stale write must not block the request.
  await env.DB.prepare('UPDATE freellm_upstream_keys SET last_used_at = ? WHERE id = ?')
    .bind(now, key.id)
    .run()
    .catch(() => {})
  return { key, apiKey }
}

/**
 * Records the outcome of a request against a config. Health is layered:
 *   - ok: mark the key live/slow, reset its failures/cooldown, and roll the
 *     endpoint EWMA + clear endpoint failures; bump the config's served count.
 *   - 429 with a known key: cool down that key only (quota), leave the
 *     endpoint serving via its other keys.
 *   - other failure: cool down the whole endpoint (all keys share it).
 */
export async function recordOutcome(
  env: Bindings,
  providerId: string,                // upstream provider id
  modelProviderId: string,           // model_provider row id (for messages_served)
  outcome: { ok: boolean; latencyMs: number; error?: string; keyId?: string; status?: number },
): Promise<void> {
  const now = Date.now()
  const error = outcome.error?.slice(0, 300) ?? 'unknown error'

  if (outcome.ok) {
    const status = outcome.latencyMs > SLOW_THRESHOLD_MS ? 'slow' : 'live'
    const statements = []
    if (outcome.keyId) {
      statements.push(
        env.DB.prepare(
          `UPDATE freellm_upstream_keys
           SET status = ?, consecutive_failures = 0, cooldown_until = NULL,
               last_used_at = ?, last_error = NULL, updated_at = ?
           WHERE id = ?`,
        ).bind(status, now, now, outcome.keyId),
      )
    }
    // Update upstream provider health (shared across all aliases using it).
    statements.push(
      env.DB.prepare(
        `UPDATE freellm_upstream_providers
         SET status = ?, last_checked_at = ?, last_error = NULL, consecutive_failures = 0,
             cooldown_until = NULL,
             avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN ?
                                   ELSE CAST(avg_latency_ms * ? + ? * ? AS INTEGER) END,
             updated_at = ?
         WHERE id = ?`,
      ).bind(
        status,
        now,
        outcome.latencyMs,
        ROLLING_AVG_BETA,
        outcome.latencyMs,
        ROLLING_AVG_ALPHA,
        now,
        providerId,
      ),
    )
    // Also bump messages_served on the specific model_provider row.
    statements.push(
      env.DB.prepare(
        `UPDATE freellm_model_providers
         SET messages_served = messages_served + 1, updated_at = ?
         WHERE id = ?`,
      ).bind(now, modelProviderId),
    )
    await env.DB.batch(statements)
    return
  }

  // Quota exhaustion on a specific key: cool that key, not the endpoint.
  if (outcome.keyId && outcome.status === 429) {
    const keyRow = await env.DB.prepare(
      `SELECT consecutive_failures FROM freellm_upstream_keys WHERE id = ?`,
    )
      .bind(outcome.keyId)
      .first<{ consecutive_failures: number }>()
    const providerRow = await env.DB.prepare(
      `SELECT cooldown_base_ms FROM freellm_upstream_providers WHERE id = ?`,
    )
      .bind(providerId)
      .first<{ cooldown_base_ms: number | null }>()
    const keyFailures = (keyRow?.consecutive_failures ?? 0) + 1
    const base = providerRow?.cooldown_base_ms ?? FAILED_PROVIDER_COOLDOWN_MS
    const keyBackoff = cooldownForAttempt(base, keyFailures)
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE freellm_upstream_keys
         SET status = 'down', consecutive_failures = ?, cooldown_until = ?,
             last_used_at = ?, last_error = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(keyFailures, now + keyBackoff, now, error, now, outcome.keyId),
      // Record the endpoint error but leave it serving via its other keys.
      env.DB.prepare(
        `UPDATE freellm_upstream_providers SET last_checked_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      ).bind(now, error, now, providerId),
    ])
    return
  }

  // Infrastructure failure: cool down the whole endpoint, and mark the specific
  // key down if we know which one failed.
  const row = await env.DB.prepare(
    `SELECT consecutive_failures, cooldown_base_ms
     FROM freellm_upstream_providers WHERE id = ?`,
  )
    .bind(providerId)
    .first<{ consecutive_failures: number; cooldown_base_ms: number | null }>()
  const failures = (row?.consecutive_failures ?? 0) + 1
  const base = row?.cooldown_base_ms ?? FAILED_PROVIDER_COOLDOWN_MS
  const backoff = cooldownForAttempt(base, failures)

  const statements = [
    env.DB.prepare(
      `UPDATE freellm_upstream_providers
       SET status = 'down', last_checked_at = ?, last_error = ?, consecutive_failures = ?,
           cooldown_until = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(now, error, failures, now + backoff, now, providerId),
  ]
  if (outcome.keyId) {
    statements.push(
      env.DB.prepare(
        `UPDATE freellm_upstream_keys SET status = 'down', last_error = ?, updated_at = ? WHERE id = ?`,
      ).bind(error, now, outcome.keyId),
    )
  }
  await env.DB.batch(statements)
}

/**
 * Opens a streaming chat call against an alias, walking its candidate configs
 * until one accepts the request (failover). Health is recorded per attempt.
 * On success returns the winning provider AND the key that served it, so the
 * caller can record the success outcome against the same key.
 */
export async function openStreamingCall(
  env: Bindings,
  alias: AliasWithProviders,
  messages: ChatMessage[],
  options: { maxTokens: number; sampling?: { temperature?: number; top_p?: number }; requiredCapabilities?: string[] },
): Promise<
  | { provider: ModelProviderRow & { upstream: UpstreamProviderWithModel }; key: UpstreamKeyRow; response: Response }
  | { error: string }
> {
  const candidates = await resolveCandidates(env, alias, Date.now(), { requiredCapabilities: options.requiredCapabilities })
  if (candidates.length === 0) return { error: 'no usable provider configs' }

  let lastError = ''
  for (const candidate of candidates) {
    const startedAt = Date.now()
    try {
      const selected = await providerApiKey(env, candidate.upstream)
      if (!selected) {
        lastError = 'no usable keys'
        continue
      }
      const { response } = await callProvider(
        { id: candidate.id, base_url: candidate.upstream.base_url, upstream_model: candidate.upstream_model },
        selected.apiKey,
        messages,
        { maxTokens: options.maxTokens, stream: true, sampling: options.sampling },
      )
      if (response.ok && response.body) return { provider: candidate, key: selected.key, response }
      lastError = `${response.status} ${response.statusText}`
      const detail = (await response.text().catch(() => '')).slice(0, 200)
      await recordOutcome(env, candidate.upstream.id, candidate.id, {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: `${lastError} ${detail}`,
        keyId: selected.key.id,
        status: response.status,
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

/**
 * Opens a chat call against an alias, trying streaming first and falling
 * back to non-streaming if the upstream doesn't support SSE. Health is
 * recorded per attempt. On success returns the winning provider, key, and
 * either a streaming Response (with usage in stream) or a non-streaming
 * Response with usage parsed from JSON.
 */
export async function openCall(
  env: Bindings,
  alias: AliasWithProviders,
  messages: ChatMessage[],
  options: { maxTokens: number; sampling?: { temperature?: number; top_p?: number }; requiredCapabilities?: string[] },
): Promise<
  | { provider: ModelProviderRow & { upstream: UpstreamProviderWithModel }; key: UpstreamKeyRow; response: Response; usage?: { input: number; output: number; total: number } | null; streaming: boolean }
  | { error: string }
> {
  const candidates = await resolveCandidates(env, alias, Date.now(), { requiredCapabilities: options.requiredCapabilities })
  if (candidates.length === 0) return { error: 'no usable provider configs' }

  let lastError = ''
  for (const candidate of candidates) {
    const startedAt = Date.now()
    try {
      const selected = await providerApiKey(env, candidate.upstream)
      if (!selected) {
        lastError = 'no usable keys'
        continue
      }

      const supportsStreaming = candidate.upstream.supports_streaming === 1

      if (supportsStreaming) {
        // Try streaming first
        const { response } = await callProvider(
          { id: candidate.id, base_url: candidate.upstream.base_url, upstream_model: candidate.upstream_model },
          selected.apiKey,
          messages,
          { maxTokens: options.maxTokens, stream: true, sampling: options.sampling },
        )
        if (response.ok && response.body) return { provider: candidate, key: selected.key, response, streaming: true }
        lastError = `${response.status} ${response.statusText}`
        const detail = (await response.text().catch(() => '')).slice(0, 200)
        await recordOutcome(env, candidate.upstream.id, candidate.id, {
          ok: false,
          latencyMs: Date.now() - startedAt,
          error: `${lastError} ${detail}`,
          keyId: selected.key.id,
          status: response.status,
        })

        // If the error indicates streaming is not supported, try non-streaming
        const isStreamingNotSupported = response.status === 400 || response.status === 405 || response.status === 501
        if (isStreamingNotSupported) {
          // Fall through to non-streaming attempt below
        } else {
          continue
        }
      }

      // Non-streaming fallback
      const { response, usage } = await callProviderNonStreaming(
        { id: candidate.id, base_url: candidate.upstream.base_url, upstream_model: candidate.upstream_model },
        selected.apiKey,
        messages,
        { maxTokens: options.maxTokens, sampling: options.sampling },
      )
      if (response.ok) return { provider: candidate, key: selected.key, response, usage, streaming: false }
      lastError = `${response.status} ${response.statusText}`
      const detail = (await response.text().catch(() => '')).slice(0, 200)
      await recordOutcome(env, candidate.upstream.id, candidate.id, {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: `${lastError} ${detail}`,
        keyId: selected.key.id,
        status: response.status,
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
