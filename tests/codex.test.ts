import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCodexRequest,
  codexHeaders,
  codexToOpenAIStream,
  needsCodexRefresh,
  refreshCodexToken,
  translateCodexEvent,
  CODEX_CLIENT_ID,
} from '../functions/lib/codex'
import { CODEX_DEFAULT_ENDPOINT, validateAccountId, validateProtocol } from '../functions/lib/validate'

test('buildCodexRequest: Responses shape, developer role, forced stream/store', () => {
  const body = buildCodexRequest(
    [
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
    ],
    'gpt-5.5',
  )
  assert.equal(body.model, 'gpt-5.5')
  assert.equal(body.stream, true)
  assert.equal(body.store, false)
  const input = body.input as Array<{ role: string; content: Array<{ text: string }> }>
  assert.equal(input[0].role, 'developer')
  assert.equal(input[1].role, 'user')
  assert.equal(input[1].content[0].text, 'hi')
  assert.deepEqual(body.reasoning, { effort: 'low', summary: 'auto' })
  assert.ok(!('temperature' in body) && !('max_tokens' in body), 'chat-only params must never reach Codex')
})

test('buildCodexRequest: empty history becomes a placeholder turn', () => {
  const body = buildCodexRequest([], 'gpt-5.5')
  const input = body.input as unknown[]
  assert.equal(input.length, 1)
})

test('codexHeaders: CLI identity + optional account binding', () => {
  const base = codexHeaders('tok')
  assert.equal(base.Authorization, 'Bearer tok')
  assert.equal(base.originator, 'codex_cli_rs')
  assert.ok(!('ChatGPT-Account-ID' in base))
  assert.equal(codexHeaders('tok', 'acc-1')['ChatGPT-Account-ID'], 'acc-1')
})

test('translateCodexEvent: deltas, usage, failures', () => {
  assert.deepEqual(translateCodexEvent({ type: 'response.output_text.delta', delta: 'Hello' }), {
    kind: 'delta',
    content: 'Hello',
  })
  assert.deepEqual(translateCodexEvent({ type: 'response.output_text.delta', delta: '' }), { kind: 'ignored' })
  assert.deepEqual(
    translateCodexEvent({
      type: 'response.completed',
      response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    }),
    { kind: 'usage', usage: { input: 10, output: 5, total: 15 } },
  )
  assert.deepEqual(
    translateCodexEvent({ type: 'response.failed', response: { error: { message: 'boom' } } }),
    { kind: 'failed', message: 'boom' },
  )
  assert.deepEqual(translateCodexEvent({ type: 'response.created' }), { kind: 'ignored' })
  assert.deepEqual(translateCodexEvent({ nope: 1 }), { kind: 'ignored' })
})

test('codexToOpenAIStream: Codex SSE becomes chat-completion chunks', async () => {
  const stream = codexToOpenAIStream()
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const out: string[] = []
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.push(decoder.decode(value))
    }
  })()
  await writer.write(
    encoder.encode(
      'event: response.output_text.delta\n' +
        'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n' +
        'event: response.output_text.delta\n' +
        'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
    ),
  )
  await writer.write(
    encoder.encode(
      'event: response.completed\n' +
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}}\n\n',
    ),
  )
  await writer.close()
  await pump

  const text = out.join('')
  assert.match(text, /"content":"Hel"/)
  assert.match(text, /"content":"lo"/)
  assert.match(text, /"prompt_tokens":10/)
  assert.match(text, /"total_tokens":15/)
})

test('needsCodexRefresh: only inside the lead window with a refresh token', () => {
  const now = Date.now()
  assert.equal(needsCodexRefresh(now + 60_000, true, now), true)
  assert.equal(needsCodexRefresh(now + 60_000_000, true, now), false)
  assert.equal(needsCodexRefresh(now - 1_000, true, now), true, 'already expired counts as needing refresh')
  assert.equal(needsCodexRefresh(now + 60_000, false, now), false)
  assert.equal(needsCodexRefresh(null, true, now), false, 'unknown expiry never triggers rotation')
})

test('refreshCodexToken: form-encoded rotation against the public endpoint', async () => {
  const previousFetch = globalThis.fetch
  const seen: Array<{ url: unknown; init: RequestInit }> = []
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    seen.push({ url, init: init ?? {} })
    return {
      ok: true,
      json: async () => ({ access_token: 'new-access', refresh_token: 'rotated', expires_in: 3600 }),
    }
  }) as unknown as typeof fetch
  try {
    const before = Date.now()
    const result = await refreshCodexToken('old-refresh')
    assert.equal(result.accessToken, 'new-access')
    assert.equal(result.refreshToken, 'rotated')
    assert.ok(
      result.expiresAt != null && result.expiresAt >= before + 3_599_000 && result.expiresAt <= Date.now() + 3_601_000,
    )
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, 'https://auth.openai.com/oauth/token')
    const body = String((seen[0].init.body as string) ?? '')
    assert.match(body, /grant_type=refresh_token/)
    assert.match(body, new RegExp(`client_id=${CODEX_CLIENT_ID}`))
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('refreshCodexToken: surfaces upstream refusal', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () => ({
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    text: async () => 'invalid_grant',
  })) as unknown as typeof fetch
  try {
    await assert.rejects(refreshCodexToken('dead'), /Codex token refresh failed \(400\)/)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('vault validators: protocol default + account id bounds', () => {
  assert.equal(validateProtocol(undefined), 'openai')
  assert.equal(validateProtocol('codex'), 'codex')
  assert.equal(validateProtocol('responses'), null)
  assert.equal(validateAccountId(undefined), null)
  assert.equal(validateAccountId(''), null)
  assert.equal(validateAccountId('acc-123'), 'acc-123')
  assert.equal(validateAccountId('x'.repeat(129)), 'Account ID must be 1–128 characters.')
  assert.equal(CODEX_DEFAULT_ENDPOINT, 'https://chatgpt.com/backend-api/codex/responses')
})
