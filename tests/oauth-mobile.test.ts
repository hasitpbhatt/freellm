// Sanity checks for the OAuth device-flow mobile experience (TASK-004):
// provider loading, large readable codes, copy-to-clipboard, step-by-step
// guidance, and polling status.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (p: string) => require('fs').readFileSync(p, 'utf8')
const oauth = read('./src/components/keys/OAuthProviders.tsx')

test('oauth providers load on mount (regression guard)', () => {
  assert.ok(oauth.includes('useEffect(() => {'), 'component has a mount effect')
  assert.ok(oauth.includes('void loadProviders()'), 'the effect loads the provider list')
  assert.ok(oauth.includes("api.get<{ providers: OAuthProvider[] }>('/oauth/providers')"), 'hits the providers endpoint')
})

test('device flow shows a large, readable, copyable code', () => {
  assert.ok(oauth.includes('text-4xl'), 'code renders large (mobile legibility)')
  assert.ok(oauth.includes('font-bold'), 'code is bold')
  assert.ok(oauth.includes('select-all'), 'code is selectable by hand')
  assert.ok(oauth.includes('formatCode'), 'code is grouped for legibility')
  assert.ok(oauth.includes('navigator.clipboard.writeText'), 'copy button uses the clipboard API')
  assert.ok(oauth.includes('✓ Copied'), 'copy gives feedback')
})

test('copy degrades gracefully when the clipboard is unavailable', () => {
  assert.ok(oauth.includes('catch'), 'clipboard call is guarded')
  assert.ok(oauth.includes('insecure context'), 'explains why it can fail')
  assert.ok(oauth.includes('selectable'), 'code remains selectable as the fallback')
})

test('device flow is a two-step guided sequence', () => {
  assert.ok(oauth.includes('Step 1'), 'step 1 labelled')
  assert.ok(oauth.includes('Step 2'), 'step 2 labelled')
  assert.ok(oauth.includes('enter this code'), 'step 1 explains the action')
  assert.ok(oauth.includes('approve on the opened page'), 'step 2 explains the action')
  assert.ok(oauth.includes('keep this page open'), 'tells the user not to close the tab')
  assert.ok(oauth.includes('Open verification page again'), 're-open link if the tab was lost')
})

test('polling state is visible and honest', () => {
  assert.ok(oauth.includes('animate-pulse'), 'live status dot while polling')
  assert.ok(oauth.includes('Waiting for approval'), 'polling message')
  assert.ok(oauth.includes('checks every'), 'states the interval')
  assert.ok(oauth.includes('up to 10 minutes'), 'states the timeout ceiling')
  assert.ok(oauth.includes('role="status"'), 'status is announced to AT')
  assert.ok(oauth.includes('animate-spin'), 'spinner on the button itself while waiting')
})

test('oauth buttons keep haptics and disabled-while-polling state', () => {
  assert.ok(oauth.includes('haptic()'), 'connect button haptics')
  assert.ok(oauth.includes('pollingProviders[p.id] != null'), 'disabled while polling')
  assert.ok(oauth.includes('Waiting on'), 'button reflects the polling state')
  assert.ok(oauth.includes('min-h-[44px]'), 'buttons meet the touch minimum')
})

test('device dialog is accessible and cancelable', () => {
  assert.ok(oauth.includes('role="dialog"'), 'dialog role')
  assert.ok(oauth.includes('aria-label="Device authorization"'), 'dialog is labelled')
  assert.ok(oauth.includes('onCancelDevice'), 'cancel wired')
  assert.ok(oauth.includes('Cancel'), 'cancel button visible')
  assert.ok(oauth.includes('rel="noreferrer"'), 'external link is hardened')
})

test('provider failure surfaces support contact', () => {
  assert.ok(oauth.includes('Contact help@freellm.hasit.in'), 'error path includes support email')
  assert.ok(oauth.includes('role="alert"'), 'error is an alert')
  assert.ok(oauth.includes('Retry'), 'retry available when the list is empty')
})

test('codes are grouped only when they look like an 8-char code', () => {
  assert.ok(oauth.includes("clean.length !== 8"), 'grouping guarded by length')
  assert.ok(oauth.includes('return code.toUpperCase()'), 'non-8-char codes pass through')
})
