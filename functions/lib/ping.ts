// Live connectivity probe for any OpenAI-compatible endpoint — used by admin
// config tests and BYOK key validation.

import { SLOW_THRESHOLD_MS } from './providers'
import { assertSafeBaseUrl } from './validate'
import { pickProxy, markProxyCooldown } from './proxy'
import type { ProxyRow } from './types'

export type PingResult = {
  ok: boolean
  status: 'live' | 'slow' | 'down'
  latencyMs: number
  mode: 'models' | 'chat'
  error?: string
  viaProxy?: boolean
}

export async function pingProvider(
  baseUrl: string,
  upstreamModel: string,
  apiKey: string,
  proxy?: ProxyRow | null,
): Promise<PingResult> {
  const base = baseUrl.replace(/\/+$/, '')
  // SSRF guard: never probe a private/link-local host from the server side.
  assertSafeBaseUrl(base)
  const started = Date.now()
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

  // If proxy is provided, test the proxy connectivity and return that result.
  // Note: In Cloudflare Workers, we cannot easily route fetch() through a proxy.
  // The actual model routing via proxy happens at the edge in the real request flow.
  if (proxy) {
    const proxyTest = await testProxyConnectivity(proxy)
    return {
      ok: proxyTest.ok,
      status: proxyTest.ok ? 'live' : 'down',
      latencyMs: Date.now() - started,
      mode: 'models',
      viaProxy: true,
      error: proxyTest.error,
    }
  }

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
      return { ok: true, status: latencyMs > SLOW_THRESHOLD_MS ? 'slow' : 'live', latencyMs, mode, viaProxy: false }
    }
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    return {
      ok: false,
      status: 'down',
      latencyMs,
      mode,
      viaProxy: false,
      error: `${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
    }
  } catch (err) {
    return {
      ok: false,
      status: 'down',
      latencyMs: Date.now() - started,
      mode: 'models',
      viaProxy: false,
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}

async function testProxyConnectivity(proxy: ProxyRow): Promise<{ ok: boolean; error?: string }> {
  try {
    const mod = (await import('cloudflare:sockets')) as unknown as {
      connect: (opts: { hostname: string; port: number }) => Promise<any>
    }
    const proxyUrl = new URL(proxy.url)
    const socket = await mod.connect({ hostname: proxyUrl.hostname, port: Number(proxyUrl.port) || 8080 })
    const writer = socket.writable.getWriter()
    const encoder = new TextEncoder()
    const reader = socket.readable.getReader()

    // Send CONNECT to a reliable test endpoint (google.com:443)
    const connectReq = `CONNECT www.google.com:443 HTTP/1.1\r\nHost: www.google.com:443\r\n\r\n`
    await writer.write(encoder.encode(connectReq))

    let responseText = ''
    const timeoutMs = 10000
    const start = Date.now()
    while (true) {
      if (Date.now() - start > timeoutMs) {
        return { ok: false, error: 'Proxy connection timeout' }
      }
      const { done, value } = await reader.read()
      if (done) break
      responseText += new TextDecoder().decode(value)
      if (responseText.includes('\r\n\r\n')) break
    }
    if (!responseText.includes('200')) {
      return { ok: false, error: `Proxy CONNECT failed: ${responseText.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Proxy connection failed' }
  }
}
