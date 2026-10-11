import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateReferralCode,
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
