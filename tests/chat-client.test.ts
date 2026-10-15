import { test } from 'node:test'
import assert from 'node:assert/strict'
import { streamChat } from '../src/lib/chat'

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

test('streamChat parses split SSE chunks, tolerant deltas, and a final event without a newline', async () => {
  const deltas: string[] = []
  const usages: unknown[] = []
  const settled: unknown[] = []
  globalThis.fetch = (async () =>
    ({
      ok: true,
      body: sseBody([
        'data: {"cho',
        'ices":[{"delta":{"content":"Hel',
        'lo"}}]}\n\ndata: {"choices":[{"text":" world"}]}\n\n',
        'data: {"type":"usage","input":11,"output":5,"total":16,"source":"reported"}\n',
        'data: {"type":"settled","credits_charged":16,"balance":{"global":999984,"scoped":0},"status":"completed"}',
      ]),
    })) as unknown as typeof fetch

  const result = await streamChat(
    {
      model: 'stepfun-5',
      request_id: '00000000-0000-4000-8000-000000000000',
      messages: [{ role: 'user', content: 'hi' }],
    },
    {
      onDelta: (content) => {
        deltas.push(content)
      },
      onUsage: (usage) => {
        usages.push(usage)
      },
      onSettled: (event) => {
        settled.push(event)
      },
    },
  )

  assert.equal(result.completed, true)
  assert.deepEqual(deltas, ['Hello', ' world'])
  assert.deepEqual(usages, [{ input: 11, output: 5, total: 16, source: 'reported' }])
  assert.equal(settled.length, 1)
})

test('streamChat consumes the non-streaming JSON fallback with server billing', async () => {
  const deltas: string[] = []
  const usages: unknown[] = []
  const settled: unknown[] = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    ({
      ok: true,
      // Non-null body: the client treats (ok + body) as a live response and
      // branches on content-type from there.
      body: {} as unknown as ReadableStream<Uint8Array>,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello JSON' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        billing: {
          credits_charged: 14,
          balance: { global: 999986, scoped: 0 },
          status: 'completed',
          source: 'reported',
          model: 'gemini-flash',
          provider: 'Google',
        },
      }),
    })) as unknown as typeof fetch

  try {
    const result = await streamChat(
      {
        model: 'gemini-flash',
        request_id: '00000000-0000-4000-8000-000000000002',
        messages: [{ role: 'user', content: 'hi' }],
      },
      {
        onDelta: (content) => {
          deltas.push(content)
        },
        onUsage: (usage) => {
          usages.push(usage)
        },
        onSettled: (event) => {
          settled.push(event)
        },
      },
    )

    assert.equal(result.completed, true)
    assert.deepEqual(deltas, ['Hello JSON'])
    assert.deepEqual(usages, [{ input: 10, output: 4, total: 14, source: 'reported' }])
    assert.deepEqual(settled, [
      {
        type: 'settled',
        credits_charged: 14,
        balance: { global: 999986, scoped: 0 },
        status: 'completed',
        model: 'gemini-flash',
        provider: 'Google',
      },
    ])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('streamChat returns HTTP failures instead of throwing', async () => {
  globalThis.fetch = (async () =>
    ({
      ok: false,
      status: 502,
      body: null,
      json: async () => ({ message: 'stepfun-5 is unavailable right now — no charge.' }),
    })) as unknown as typeof fetch

  const result = await streamChat(
    {
      model: 'stepfun-5',
      request_id: '00000000-0000-4000-8000-000000000001',
      messages: [{ role: 'user', content: 'hi' }],
    },
    {
      onDelta: () => {},
      onSettled: () => {},
    },
  )

  assert.equal(result.completed, false)
  assert.equal(result.error, 'stepfun-5 is unavailable right now — no charge.')
})
