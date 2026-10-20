import test from 'node:test'
import assert from 'node:assert/strict'
import { allowRequest } from '../functions/lib/ratelimit'

function fakeKv(): { store: Map<string, string>; kv: KVNamespace } {
  const store = new Map<string, string>()
  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value)
    },
  } as unknown as KVNamespace
  return { store, kv }
}

test('allowRequest: allows up to the limit, then rejects inside the window', async () => {
  const { kv } = fakeKv()
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await allowRequest(kv, 'rate:user', 3, 60), true)
  }
  assert.equal(await allowRequest(kv, 'rate:user', 3, 60), false)
  assert.equal(await allowRequest(kv, 'rate:user', 3, 60), false)
})

test('allowRequest: an expired window starts a fresh count', async () => {
  const { store, kv } = fakeKv()
  assert.equal(await allowRequest(kv, 'rate:user', 1, 60), true)
  assert.equal(await allowRequest(kv, 'rate:user', 1, 60), false)

  const entry = JSON.parse(store.get('rate:user')!)
  store.set('rate:user', JSON.stringify({ ...entry, resetAt: Date.now() - 1 }))

  assert.equal(await allowRequest(kv, 'rate:user', 1, 60), true)
})

test('allowRequest: corrupt entries reset instead of locking the caller out', async () => {
  const { store, kv } = fakeKv()
  store.set('rate:user', 'not json')
  assert.equal(await allowRequest(kv, 'rate:user', 1, 60), true)
})
