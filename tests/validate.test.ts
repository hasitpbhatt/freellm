import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertSafeBaseUrl,
  generateReferralCode,
  isPrivateHost,
  normalizeEmail,
  normalizeUsername,
  slugify,
  validateBaseUrl,
  validateBearer,
  validateCapabilities,
  validateEmail,
  validatePassword,
  validateUpstreamModel,
  validateUsername,
} from '../functions/lib/validate'

test('validateEmail: shape and disposable-domain gate', () => {
  assert.equal(validateEmail('user@example.com'), null)
  assert.equal(validateEmail('  user@example.com  '), null)
  assert.equal(validateEmail('not-an-email'), 'Enter a valid email address.')
  assert.equal(validateEmail('a@b'), 'Enter a valid email address.')
  assert.equal(validateEmail(''), 'Enter a valid email address.')
  assert.equal(validateEmail(null), 'Enter a valid email address.')
  assert.equal(validateEmail(42), 'Enter a valid email address.')
  assert.equal(validateEmail('spam@mailinator.com'), 'Disposable email domains are not allowed.')
  assert.equal(validateEmail('SPAM@MAILINATOR.COM'), 'Disposable email domains are not allowed.')
})

test('validateUsername: 3–24 lowercase/number/underscore', () => {
  assert.equal(validateUsername('alice'), null)
  assert.equal(validateUsername('ab'), 'Username must be 3–24 characters: lowercase letters, numbers, underscores.')
  assert.equal(validateUsername('Has Spaces'), 'Username must be 3–24 characters: lowercase letters, numbers, underscores.')
  assert.equal(validateUsername('Alice'), null, 'case is normalized before validating')
})

test('validatePassword: 8–200 chars', () => {
  assert.equal(validatePassword('12345678'), null)
  assert.equal(validatePassword('short'), 'Password must be at least 8 characters.')
  assert.equal(validatePassword('x'.repeat(201)), 'Password is too long.')
})

test('validateBaseUrl: https required unless http allowed', () => {
  assert.equal(validateBaseUrl('https://api.example.com/v1', false), null)
  assert.equal(validateBaseUrl('http://localhost:8788/v1', true), null)
  assert.equal(validateBaseUrl('http://localhost:8788/v1', false), 'Base URL must use https.')
  assert.equal(validateBaseUrl('ftp://example.com', false), 'Base URL must use https.')
  assert.equal(validateBaseUrl('api.example.com', false), 'Base URL must be an absolute URL (e.g. https://api.example.com/v1).')
  assert.equal(validateBaseUrl('   ', false), 'Base URL is required.')
})

test('validateUpstreamModel / validateBearer: required, bounded', () => {
  assert.equal(validateUpstreamModel('gpt-4o'), null)
  assert.equal(validateUpstreamModel('  '), 'Upstream model name is required.')
  assert.equal(validateUpstreamModel('x'.repeat(121)), 'Upstream model name is too long.')
  assert.equal(validateBearer('sk-abc'), null)
  assert.equal(validateBearer(''), 'Bearer key is required.')
  assert.equal(validateBearer('k'.repeat(501)), 'Bearer key is too long.')
})

test('validateCapabilities: tag shape and cap', () => {
  assert.equal(validateCapabilities(undefined), null)
  assert.equal(validateCapabilities(['coding', 'fast']), null)
  assert.equal(validateCapabilities('coding'), 'Capabilities must be an array of tags.')
  assert.equal(validateCapabilities(Array.from({ length: 9 }, (_, i) => `tag-${i}`)), 'At most 8 capability tags.')
  assert.equal(validateCapabilities(['Bad Tag']), 'Capability tags must be 2–24 chars: lowercase letters, numbers, hyphens.')
})

test('normalizers: trim + lowercase', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com')
  assert.equal(normalizeUsername('  Alice '), 'alice')
})

test('slugify: human label -> slug', () => {
  assert.equal(slugify('Poolside Laguna'), 'poolside-laguna')
  assert.equal(slugify('  --Hello, World!  '), 'hello-world')
  assert.equal(slugify('x'.repeat(60)).length, 48)
})

test('generateReferralCode: 8 chars from the unambiguous alphabet', () => {
  for (let i = 0; i < 20; i += 1) {
    const code = generateReferralCode()
    assert.match(code, /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/)
  }
})

// ------------------------------------------------------------ SSRF guard

test('isPrivateHost: flags loopback, private, link-local, and metadata space', () => {
  // IPv4 literals
  assert.equal(isPrivateHost('127.0.0.1'), true)
  assert.equal(isPrivateHost('10.0.0.5'), true)
  assert.equal(isPrivateHost('192.168.1.1'), true)
  assert.equal(isPrivateHost('172.16.0.1'), true)
  assert.equal(isPrivateHost('172.31.255.255'), true)
  assert.equal(isPrivateHost('169.254.169.254'), true, 'cloud metadata IP')
  assert.equal(isPrivateHost('100.64.0.1'), true, 'CGNAT')
  assert.equal(isPrivateHost('0.0.0.0'), true)
  assert.equal(isPrivateHost('224.0.0.1'), true, 'multicast')
  // public IPv4 is allowed
  assert.equal(isPrivateHost('8.8.8.8'), false)
  assert.equal(isPrivateHost('1.1.1.1'), false)
  assert.equal(isPrivateHost('172.32.0.1'), false, 'just outside 172.16/12')
  // IPv6 literals
  assert.equal(isPrivateHost('::1'), true)
  assert.equal(isPrivateHost('::'), true)
  assert.equal(isPrivateHost('fe80::1'), true)
  assert.equal(isPrivateHost('fc00::1'), true)
  assert.equal(isPrivateHost('fd12::1'), true)
  assert.equal(isPrivateHost('::ffff:127.0.0.1'), true, 'IPv4-mapped loopback')
  assert.equal(isPrivateHost('2606:4700:4700::1111'), false, 'public Cloudflare DNS')
  // hostnames
  assert.equal(isPrivateHost('localhost'), true)
  assert.equal(isPrivateHost('metadata.google.internal'), true)
  assert.equal(isPrivateHost('foo.internal'), true)
  assert.equal(isPrivateHost('foo.local'), true)
  assert.equal(isPrivateHost('bar.localhost'), true)
  assert.equal(isPrivateHost('api.example.com'), false)
  // bracketed IPv6 from a URL hostname
  assert.equal(isPrivateHost('[::1]'), true)
  // empty is treated as private (never fetchable)
  assert.equal(isPrivateHost(''), true)
})

test('validateBaseUrl: rejects private hosts at config time unless http is allowed', () => {
  assert.equal(validateBaseUrl('https://127.0.0.1/v1', false), 'Base URL must not point at a private or internal address.')
  assert.equal(validateBaseUrl('https://169.254.169.254', false), 'Base URL must not point at a private or internal address.')
  assert.equal(validateBaseUrl('https://localhost:8080/v1', false), 'Base URL must not point at a private or internal address.')
  assert.equal(validateBaseUrl('https://api.openai.com/v1', false), null)
  // dev: http + private host is allowed so local Ollama/vLLM keep working
  assert.equal(validateBaseUrl('http://localhost:8788/v1', true), null)
})

test('assertSafeBaseUrl: throws on private/internal URLs, allows public', () => {
  assert.throws(() => assertSafeBaseUrl('https://127.0.0.1/v1'), /private or internal/)
  assert.throws(() => assertSafeBaseUrl('http://169.254.169.254/'), /private or internal/)
  assert.throws(() => assertSafeBaseUrl('http://[::1]:8080/'), /private or internal/)
  assert.throws(() => assertSafeBaseUrl('ftp://example.com'), /http\(s\)/)
  assert.throws(() => assertSafeBaseUrl('not-a-url'), /valid absolute URL/)
  assert.doesNotThrow(() => assertSafeBaseUrl('https://api.example.com/v1'))
  assert.doesNotThrow(() => assertSafeBaseUrl('http://api.example.com/v1'))
})
