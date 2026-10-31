// Live connectivity probe for any OpenAI-compatible endpoint — used by admin
// config tests and BYOK key validation.

import { SLOW_THRESHOLD_MS } from './providers'
import { assertSafeBaseUrl } from './validate'
import { pickProxy, markProxyCooldown } from './proxy'

export type PingResult = {
  ok: boolean
  status: 'live' | 'slow' | 'down'
  latencyMs: number
  mode: 'models' | 'chat'
  error?: string
}

export async function pingProvider(
  baseUrl: string,
  upstreamModel: string,
  apiKey: string,
): Promise<PingResult> {
  const base = baseUrl.replace(/\/+$/, '')
  // SSRF guard: never probe a private/link-local host from the server side.
  assertSafeBaseUrl(base)
  const started = Date.now()
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

  try {
    let response = await fetch(`${base}/models`, { headers })
    let mode: 'models' | 'chat' = 'models'
    if (response.status === 404 || response.status === 405) {
      mode = 'chat'
      response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: upstreamModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      })
    }
    const latencyMs = Date.now() - started
    if (response.ok) {
      return { ok: true, status: latencyMs > SLOW_THRESHOLD_MS ? 'slow' : 'live', latencyMs, mode }
    }
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    return {
      ok: false,
      status: 'down',
      latencyMs,
      mode,
      error: `${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
    }
  } catch (err) {
    try {
      // @ts-ignore
      const db = (globalThis as any).DB
      if (db) {
        const proxy = await pickProxy(db)
        if (proxy) await markProxyCooldown(db, proxy.id, 60000)
      }
    } catch {}
    return {
      ok: false,
      status: 'down',
      latencyMs: Date.now() - started,
      mode: 'models',
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}
