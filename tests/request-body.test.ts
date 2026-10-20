import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_REQUEST_BODY_CHARS, readJsonBody } from '../functions/lib/request-body'

test('readJsonBody: parses a small JSON body', async () => {
  const result = await readJsonBody<{ ok: boolean }>(
    new Request('https://freellm.test/api/chat', {
      method: 'POST',
      body: JSON.stringify({ ok: true }),
    }),
  )
  assert.deepEqual(result, { ok: true, value: { ok: true } })
})

test('readJsonBody: malformed JSON is a null value, not a throw', async () => {
  const result = await readJsonBody(
    new Request('https://freellm.test/api/chat', { method: 'POST', body: '{' }),
  )
  assert.deepEqual(result, { ok: true, value: null })
})

test('readJsonBody: rejects an oversized declared body before parsing', async () => {
  const request = new Request('https://freellm.test/api/chat', {
    method: 'POST',
    headers: { 'content-length': String(MAX_REQUEST_BODY_CHARS + 1) },
  })
  assert.deepEqual(await readJsonBody(request), { ok: false })
})
