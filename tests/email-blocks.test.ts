import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emailBlockedByPatterns,
  validateEmailBlockPattern,
} from '../functions/lib/email-blocks'

test('validateEmailBlockPattern: accepts compiling regexes, rejects junk', () => {
  assert.equal(validateEmailBlockPattern('.*@spam\\.com$'), null)
  assert.equal(validateEmailBlockPattern('^test.*'), null)
  assert.equal(validateEmailBlockPattern(''), 'Pattern is required.')
  assert.equal(validateEmailBlockPattern('   '), 'Pattern is required.')
  assert.equal(validateEmailBlockPattern(123), 'Pattern is required.')
  assert.equal(validateEmailBlockPattern('([a-z'), 'That is not a valid regular expression.')
  assert.equal(validateEmailBlockPattern(`x{${'1'.repeat(300)}}`) !== null, true)
})

test('emailBlockedByPatterns: first match wins, corrupt rows never lock out', () => {
  assert.equal(emailBlockedByPatterns('spammer@spam.com', ['.*@spam\\.com$']), '.*@spam\\.com$')
  assert.equal(emailBlockedByPatterns('user@gmail.com', ['.*@spam\\.com$']), null)
  assert.equal(emailBlockedByPatterns('testuser@gmail.com', ['^test.*', '.*@spam\\.com$']), '^test.*')
  assert.equal(emailBlockedByPatterns('anyone@x.com', []), null)
  // A corrupt stored pattern is skipped, not fatal.
  assert.equal(emailBlockedByPatterns('anyone@x.com', ['([a-z', '^nobody$']), null)
  assert.equal(emailBlockedByPatterns('nobody पदार्थ@x.com', ['^nobody']), '^nobody')
})
