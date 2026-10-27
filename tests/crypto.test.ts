import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
  hashPassword,
  maskSecret,
  newApiToken,
  sha256Hex,
  verifyPassword,
} from '../functions/lib/crypto'

const KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64') // arbitrary 32-byte key
const OTHER_KEY = Buffer.from(new Uint8Array(32).fill(9)).toString('base64')

test('hashPassword / verifyPassword: round-trip and rejection', async () => {
  const stored = await hashPassword('supersecret123')
  assert.equal(await verifyPassword('supersecret123', stored), true)
  assert.equal(await verifyPassword('wrong password', stored), false)

  // stored format: pbkdf2$sha256$<iterations>$<salt>$<hash>
  const parts = stored.split('$')
  assert.equal(parts.length, 5)
  assert.equal(parts[0], 'pbkdf2')
  assert.equal(parts[1], 'sha256')
  assert.equal(Number(parts[2]), 100_000)
})

test('verifyPassword: rejects malformed stored values instead of throwing', async () => {
  assert.equal(await verifyPassword('x', ''), false)
  assert.equal(await verifyPassword('x', 'not-a-hash'), false)
  assert.equal(await verifyPassword('x', 'pbkdf2$sha256$0$AAAAAAAAAAAAAAAAAAAAAA==$AAAA'), false)
  assert.equal(await verifyPassword('x', 'pbkdf2$md5$100000$AAAA$AAAA'), false)
})

test('hashPassword: each hash gets a unique salt', async () => {
  const a = await hashPassword('same-password')
  const b = await hashPassword('same-password')
  assert.notEqual(a, b)
  assert.equal(await verifyPassword('same-password', a), true)
  assert.equal(await verifyPassword('same-password', b), true)
})

test('encryptSecret / decryptSecret: round-trip', async () => {
  const { ciphertext, iv } = await encryptSecret('sk-test-1234', KEY)
  assert.equal(await decryptSecret(ciphertext, iv, KEY), 'sk-test-1234')
})

test('encryptSecret: fresh IV per call and ciphertext differs', async () => {
  const a = await encryptSecret('same-secret', KEY)
  const b = await encryptSecret('same-secret', KEY)
  assert.notEqual(a.iv, b.iv, 'IV must never repeat')
  assert.notEqual(a.ciphertext, b.ciphertext)
})

test('decryptSecret: wrong key fails (GCM auth)', async () => {
  const { ciphertext, iv } = await encryptSecret('sk-test-1234', KEY)
  await assert.rejects(() => decryptSecret(ciphertext, iv, OTHER_KEY))
})

test('decryptSecret: tampered ciphertext fails (GCM auth)', async () => {
  const { ciphertext, iv } = await encryptSecret('sk-test-1234', KEY)
  const flipped = ciphertext.slice(0, -4) + (ciphertext.endsWith('AAAA') ? 'BBBB' : 'AAAA')
  await assert.rejects(() => decryptSecret(flipped, iv, KEY))
})

test('encryptSecret: rejects keys that are not 32 bytes', async () => {
  await assert.rejects(() => encryptSecret('x', Buffer.from('short').toString('base64')))
})

test('sha256Hex: known vectors', async () => {
  // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(await sha256Hex('freellm'), '1ed9c153851729bb955b6e97c3107fb2041facecaaee0cb7393b9edc754d757e')
})

test('constantTimeEqual: compares by value, not reference', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true)
  assert.equal(constantTimeEqual('abc', 'abd'), false)
  assert.equal(constantTimeEqual('abc', 'abcd'), false)
})

test('maskSecret: shows only the last 4 characters', () => {
  assert.equal(maskSecret('sk-1234567890abcdef'), '••••cdef')
  assert.equal(maskSecret('abcd'), '••••', 'a 4-char secret reveals nothing')
  assert.equal(maskSecret('ab'), '••••')
  assert.equal(maskSecret(''), '••••')
})

test('newApiToken: greppable fl_ prefix + 32 hex chars', () => {
  const token = newApiToken()
  assert.match(token, /^fl_[0-9a-f]{32}$/)
})
