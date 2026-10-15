// Sanity checks for support-contact integration: help@freellm.hasit.in must
// be reachable from the landing page, documented in the README, and attached
// to the Keys page error paths. File-content assertions — no DB needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (p: string) => require('fs').readFileSync(p, 'utf8')

const SUPPORT_EMAIL = 'help@freellm.hasit.in'

test('landing page shows the support email as a working mailto link', () => {
  const landing = read('./src/pages/Landing.tsx')
  assert.ok(landing.includes(SUPPORT_EMAIL), 'landing page shows the email')
  assert.ok(landing.includes(`mailto:${SUPPORT_EMAIL}`), 'email is a mailto link')
  assert.ok(landing.includes('Need help?'), 'landing page labels the help line')
  assert.ok(landing.includes('We usually respond within 2 hours'), 'landing page sets a response expectation')
})

test('README documents the support email', () => {
  const readme = read('./README.md')
  assert.ok(readme.includes(SUPPORT_EMAIL), 'README mentions the email')
  assert.ok(readme.includes('Need help?'), 'README has help text')
})

test('keys page error paths attach the support contact', () => {
  const keys = read('./src/pages/Keys.tsx')
  assert.ok(keys.includes('Contact help@freellm.hasit.in'), 'keys errors mention support')
})

test('support email appears consistently across the product', () => {
  const files = ['./src/pages/Landing.tsx', './README.md', './src/pages/Keys.tsx']
  for (const f of files) {
    assert.ok(read(f).includes(SUPPORT_EMAIL), `${f} references ${SUPPORT_EMAIL}`)
  }
})
