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
