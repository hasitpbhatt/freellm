// Provider multiplexing: resolving a model alias to one of its upstream
// configs and calling it.
//
// An alias (freellm_models row) groups N provider configs (freellm_model_providers rows).
// The alias's routing strategy picks among them:
//   round_robin — rotating counter in KV, even spread
//   random      — uniform pick
//   failover    — priority order (lower first)
// Any strategy falls through to the next candidate when the upstream
// refuses the request (5xx/429), which is what makes a degraded pool
// survivable.
//
// Minimal interface for any upstream caller — pool configs or BYOK keys.

import { decryptSecret } from './crypto'
import type { Bindings, ModelProviderRow, ModelRow } from './types'

const ROLLING_AVG_ALPHA = 0.3
const ROLLING_AVG_BETA = 0.7

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
export async function resolveCandidates(env: Bindings, alias: AliasWithProviders): Promise<ModelProviderRow[]> {
  const usable = alias.providers.filter((p) => p.status !== 'disabled')
  if (usable.length === 0) return []

  // Prefer healthy configs; a 'down' config is only used when it's all we have.
  const healthy = usable.filter((p) => p.status !== 'down')
  const pool = healthy.length > 0 ? healthy : usable

  switch (alias.model.routing) {
    case 'random':
      return shuffle(pool)
    case 'failover':
      return [...pool].sort((a, b) => a.priority - b.priority)
    case 'round_robin':
    default: {
      // KV counter per alias; a counter miss just falls back to a random order.
      try {
        const key = `rr:${alias.model.id}`
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
  }
}

function shuffle<T>(items: T[]): T[] {
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
 * the caller owns parsing and settlement.
 */
export async function callProvider(
  provider: UpstreamConfig,
  apiKey: string,
  messages: ChatMessage[],
  options: { maxTokens: number; stream: boolean; sampling?: { temperature?: number; top_p?: number } },
): Promise<UpstreamCall> {
  const base = provider.base_url.replace(/\/+$/, '')
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
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
           avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN ?
                                 ELSE CAST(avg_latency_ms * ? + ? * ? AS INTEGER) END,
           messages_served = messages_served + 1, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        outcome.latencyMs > 8000 ? 'slow' : 'live',
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
    await env.DB.prepare(
      `UPDATE freellm_model_providers
       SET status = 'down', last_checked_at = ?, last_error = ?, consecutive_failures = consecutive_failures + 1, updated_at = ?
       WHERE id = ?`,
    )
      .bind(Date.now(), outcome.error?.slice(0, 300) ?? 'unknown error', Date.now(), providerId)
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
