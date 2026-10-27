// Codex (ChatGPT backend) adapter for BYOK vault rows with protocol='codex'.
//
// A Codex account speaks the Responses API, not Chat Completions:
//   POST https://chatgpt.com/backend-api/codex/responses
//   Headers: Authorization: Bearer <user OAuth access token>,
//            originator: codex_cli_rs, version + codex-style User-Agent,
//            optional ChatGPT-Account-ID binding for multi-account users.
//   Body: { model, input: [...], instructions, stream: true, store: false,
//           reasoning: { effort, summary }, include: [...] }
//   SSE: event: response.output_text.delta / response.completed (usage) /
//        response.failed.
//
// This module translates Codex SSE into OpenAI Chat Completions SSE chunks
// (delta.content + usage block) so the existing BYOK settle/metering paths in
// routes/chat.ts and routes/openai.ts work unchanged regardless of protocol.
//
// OAuth refresh mirrors the public Codex CLI flow (same client id, same token
// endpoint — see 9router's MIT-licensed registry): rotation-aware, i.e. only
// refreshed inside the lead window, because each refresh rotates the token and
// hammering the endpoint revokes the user's OpenAI session.
//
// Safety: credentials here are strictly per-user vault rows (never pooled).
// Only the owner can add, use, or delete them; OAuth rows are not revealable
// even to the operator.

import { decryptSecret, encryptSecret } from './crypto'
import { sanitizeUsage, type Usage } from './metering'
import type { ConnectionRow } from './types'
import { assertSafeBaseUrl } from './validate'

/** Identity the Codex backend expects (matches the official CLI family). */
export const CODEX_CLI_VERSION = '0.159.0'

/** Public OAuth client id of the Codex CLI (used for refresh of user tokens). */
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token'
export const CODEX_OAUTH_SCOPE = 'openid profile email offline_access'

/** Refresh only inside this window: every refresh rotates the token. */
export const CODEX_REFRESH_LEAD_MS = 10 * 60 * 1000

export const CODEX_DEFAULT_MODEL = 'gpt-5.5'

export type CodexMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** Responses-API request body for a plain chat turn. Pure. */
export function buildCodexRequest(messages: CodexMessage[], model: string): Record<string, unknown> {
  const input = messages
    .filter((m) => typeof m.content === 'string' && m.content.length > 0)
    .map((m) => ({
      type: 'message',
      // System prompts stay in the cacheable prefix as developer messages.
      role: m.role === 'system' ? 'developer' : m.role,
      content: [{ type: 'input_text', text: m.content }],
    }))
  if (input.length === 0) {
    input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '...' }] })
  }
  return {
    model,
    input,
    stream: true,
    store: false,
    reasoning: { effort: 'low', summary: 'auto' },
    include: ['reasoning.encrypted_content'],
  }
}

export function codexHeaders(accessToken: string, accountId?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    originator: 'codex_cli_rs',
    'User-Agent': `codex_cli_rs/${CODEX_CLI_VERSION}`,
    version: CODEX_CLI_VERSION,
  }
  if (accountId) headers['ChatGPT-Account-ID'] = accountId
  return headers
}

/** POSTs exactly `endpoint` (no path appended — it is the full responses URL). */
export async function callCodex(
  endpoint: string,
  accessToken: string,
  accountId: string | null | undefined,
  messages: CodexMessage[],
  model: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const url = endpoint.replace(/\/+$/, '')
  assertSafeBaseUrl(url)
  const signal =
    opts.signal ??
    (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(opts.timeoutMs ?? 60_000) : undefined)
  return fetch(url, {
    method: 'POST',
    headers: codexHeaders(accessToken, accountId),
    ...(signal ? { signal } : {}),
    body: JSON.stringify(buildCodexRequest(messages, model)),
  })
}

export type CodexEvent =
  | { kind: 'delta'; content: string }
  | { kind: 'usage'; usage: Usage }
  | { kind: 'failed'; message: string }
  | { kind: 'ignored' }

/** Maps one parsed Codex SSE data payload to an OpenAI-side effect. Pure. */
export function translateCodexEvent(data: Record<string, unknown>): CodexEvent {
  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'response.output_text.delta') {
    const delta = typeof data.delta === 'string' ? data.delta : ''
    return delta ? { kind: 'delta', content: delta } : { kind: 'ignored' }
  }
  if (type === 'response.completed' || type === 'response.incomplete') {
    const response = data.response as { usage?: unknown } | undefined
    const u = (response?.usage ?? data.usage) as
      | { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown }
      | undefined
    const clean =
      u && typeof u === 'object'
        ? sanitizeUsage({
            input: typeof u.input_tokens === 'number' ? u.input_tokens : NaN,
            output: typeof u.output_tokens === 'number' ? u.output_tokens : NaN,
            total: typeof u.total_tokens === 'number' ? u.total_tokens : NaN,
          })
        : null
    return clean ? { kind: 'usage', usage: clean } : { kind: 'ignored' }
  }
  if (type === 'response.failed') {
    const response = data.response as { error?: { message?: unknown }; status?: unknown } | undefined
    const message =
      (response?.error && typeof response.error.message === 'string' && response.error.message) ||
      'The Codex backend failed this response.'
    return { kind: 'failed', message: message.slice(0, 300) }
  }
  return { kind: 'ignored' }
}

function parseSseData(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === '[DONE]') return null
  try {
    const parsed = JSON.parse(payload) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Codex SSE -> OpenAI Chat Completions SSE. Emits `choices[0].delta.content`
 * chunks plus a trailing `usage` block the freellm settlers already parse.
 * A `response.failed` stops text emission; the route still settles per the
 * existing incomplete-stream policy (completed, flat-rate fallback) — the
 * same contract as a truncated pool stream.
 */
export function codexToOpenAIStream(): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ''
  let failed = false
  const emit = (controller: TransformStreamDefaultController<Uint8Array>, obj: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
  }
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (failed) return
      const text = decoder.decode(chunk, { stream: true })
      const lines = (buffer + text).split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const parsed = parseSseData(line)
        if (!parsed) continue
        const event = translateCodexEvent(parsed)
        if (event.kind === 'delta') {
          emit(controller, { choices: [{ index: 0, delta: { content: event.content } }] })
        } else if (event.kind === 'usage') {
          emit(controller, {
            usage: {
              prompt_tokens: event.usage.input,
              completion_tokens: event.usage.output,
              total_tokens: event.usage.total,
            },
          })
        } else if (event.kind === 'failed') {
          failed = true
        }
      }
    },
    flush(controller) {
      buffer += decoder.decode()
      if (buffer.trim() && !failed) {
        for (const line of buffer.split('\n')) {
          const parsed = parseSseData(line)
          if (!parsed) continue
          const event = translateCodexEvent(parsed)
          if (event.kind === 'delta') {
            emit(controller, { choices: [{ index: 0, delta: { content: event.content } }] })
          } else if (event.kind === 'usage') {
            emit(controller, {
              usage: {
                prompt_tokens: event.usage.input,
                completion_tokens: event.usage.output,
                total_tokens: event.usage.total,
              },
            })
          } else if (event.kind === 'failed') {
            failed = true
          }
        }
      }
      buffer = ''
    },
  })
}

// ---------------------------------------------------------------- refresh

/** True when the access token expires inside the rotation-aware lead window. */
export function needsCodexRefresh(expiresAt: number | null | undefined, hasRefreshToken: boolean, now = Date.now()): boolean {
  if (!hasRefreshToken) return false
  if (expiresAt == null) return false
  return expiresAt - now <= CODEX_REFRESH_LEAD_MS
}

export type CodexRefreshResult = { accessToken: string; refreshToken: string | null; expiresAt: number | null }

/** Form-encoded refresh against the public token endpoint. Rotation-aware callers only. */
export async function refreshCodexToken(refreshToken: string): Promise<CodexRefreshResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CODEX_CLIENT_ID,
    refresh_token: refreshToken,
    scope: CODEX_OAUTH_SCOPE,
  })
  const response = await fetch(CODEX_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(`Codex token refresh failed (${response.status}): ${detail || response.statusText}`)
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  const accessToken = typeof data.access_token === 'string' ? data.access_token : ''
  if (!accessToken) throw new Error('Codex token refresh returned no access token.')
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
    expiresAt:
      typeof data.expires_in === 'number' && Number.isFinite(data.expires_in) && data.expires_in > 0
        ? Date.now() + Math.floor(data.expires_in * 1000)
        : null,
  }
}

// ------------------------------------------------------- vault opener
// Opens a BYOK Codex call for a vault row: refreshes a near-expiry access
// token (persisting the rotation), retries once on 401 with a stored refresh
// token, and translates the Codex SSE body into OpenAI Chat Completions SSE
// so route-level settle/metering code works unchanged. Non-OK responses are
// returned raw for the route's error handling.

export async function openByokCodexCall(
  env: { DB: D1Database; ENCRYPTION_KEY: string },
  row: ConnectionRow,
  messages: CodexMessage[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  let accessToken = await decryptSecret(row.key_ciphertext, row.key_iv, env.ENCRYPTION_KEY)
  let refreshCiphertext = row.refresh_ciphertext
  let refreshIv = row.refresh_iv

  const persistRotation = async (rotated: CodexRefreshResult) => {
    const sealedAccess = await encryptSecret(rotated.accessToken, env.ENCRYPTION_KEY)
    let sealedRefresh = { ciphertext: refreshCiphertext, iv: refreshIv }
    if (rotated.refreshToken) sealedRefresh = await encryptSecret(rotated.refreshToken, env.ENCRYPTION_KEY)
    await env.DB.prepare(
      `UPDATE freellm_connections SET key_ciphertext = ?, key_iv = ?, refresh_ciphertext = ?,
        refresh_iv = ?, expires_at = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(
        sealedAccess.ciphertext,
        sealedAccess.iv,
        sealedRefresh.ciphertext,
        sealedRefresh.iv,
        rotated.expiresAt,
        Date.now(),
        row.id,
      )
      .run()
    accessToken = rotated.accessToken
    refreshCiphertext = sealedRefresh.ciphertext
    refreshIv = sealedRefresh.iv
  }

  if (needsCodexRefresh(row.expires_at, refreshCiphertext != null) && refreshCiphertext && refreshIv) {
    const refreshToken = await decryptSecret(refreshCiphertext, refreshIv, env.ENCRYPTION_KEY)
    await persistRotation(await refreshCodexToken(refreshToken))
  }

  const dial = () =>
    callCodex(row.base_url, accessToken, row.account_id, messages, row.upstream_model, opts)

  let upstream = await dial()
  if (upstream.status === 401 && refreshCiphertext && refreshIv) {
    // Revoked early (or clock skew): one rotation retry, then surface it.
    try {
      const refreshToken = await decryptSecret(refreshCiphertext, refreshIv, env.ENCRYPTION_KEY)
      await persistRotation(await refreshCodexToken(refreshToken))
      upstream = await dial()
    } catch {
      // Fall through with the original 401 for the route's error path.
    }
  }

  if (!upstream.ok || !upstream.body) return upstream
  return new Response(upstream.body.pipeThrough(codexToOpenAIStream()), {
    status: upstream.status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

// ------------------------------------------------------------------- ping

export type CodexPing = {
  ok: boolean
  status: 'live' | 'slow' | 'down'
  latencyMs: number
  error?: string
}

const PING_SLOW_MS = 8000

/**
 * Liveness probe: sends a minimal streaming request and reads only the first
 * meaningful event, then cancels — a few input tokens, never a full answer.
 * 401/403 means the token itself is bad; any first text delta means live.
 */
export async function pingCodex(
  endpoint: string,
  model: string,
  accessToken: string,
  accountId: string | null | undefined,
): Promise<CodexPing> {
  const url = endpoint.replace(/\/+$/, '')
  try {
    assertSafeBaseUrl(url)
  } catch (err) {
    return { ok: false, status: 'down', latencyMs: 0, error: err instanceof Error ? err.message : 'Bad URL' }
  }
  const started = Date.now()
  const latency = () => Date.now() - started
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: codexHeaders(accessToken, accountId),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(25_000) : undefined,
      body: JSON.stringify({
        ...buildCodexRequest([{ role: 'user', content: 'ping' }], model),
        instructions: 'Reply with exactly: ok',
      }),
    })
  } catch (err) {
    return { ok: false, status: 'down', latencyMs: latency(), error: err instanceof Error ? err.message : 'Network error' }
  }
  if (response.status === 401 || response.status === 403) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    return { ok: false, status: 'down', latencyMs: latency(), error: `Unauthorized — this token is rejected (${response.status})${detail ? `: ${detail}` : ''}` }
  }
  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    return { ok: false, status: 'down', latencyMs: latency(), error: `${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}` }
  }

  // Read until the first text delta, usage, or failure — then cancel.
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const parsed = parseSseData(line)
        if (!parsed) continue
        const event = translateCodexEvent(parsed)
        if (event.kind === 'delta') {
          await reader.cancel().catch(() => {})
          const ms = latency()
          return { ok: true, status: ms > PING_SLOW_MS ? 'slow' : 'live', latencyMs: ms }
        }
        if (event.kind === 'failed') {
          await reader.cancel().catch(() => {})
          return { ok: false, status: 'down', latencyMs: latency(), error: event.message }
        }
        if (event.kind === 'usage') {
          await reader.cancel().catch(() => {})
          const ms = latency()
          return { ok: true, status: ms > PING_SLOW_MS ? 'slow' : 'live', latencyMs: ms }
        }
      }
      if (latency() > 20_000) break
    }
  } catch (err) {
    return { ok: false, status: 'down', latencyMs: latency(), error: err instanceof Error ? err.message : 'Stream failed' }
  } finally {
    try {
      await reader.cancel().catch(() => {})
    } catch {
      // ignore
    }
  }
  return { ok: false, status: 'down', latencyMs: latency(), error: 'No completion events arrived.' }
}
