// Sanity checks for the landing page: the two doors, their CTAs, the
// authenticated-user redirect, and the support contact. File-content
// assertions — no DB or DOM needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (p: string) => require('fs').readFileSync(p, 'utf8')

test('landing page renders the two doors with correct destinations', () => {
  const landing = read('./src/pages/Landing.tsx')
  assert.ok(landing.includes('Door 1: BYOK Vault'), 'Door 1 is present')
  assert.ok(landing.includes('Door 2: Model Marketplace'), 'Door 2 is present')
  assert.ok(landing.includes('to="/keys"'), 'Door 1 links to /keys')
  assert.ok(landing.includes('to="/models"'), 'Door 2 links to /models')
  assert.ok(landing.includes('Access Your Vault'), 'Door 1 has its CTA')
  assert.ok(landing.includes('Browse Models'), 'Door 2 has its CTA')
})

test('landing page: door copy explains each value proposition', () => {
  const landing = read('./src/pages/Landing.tsx')
  assert.ok(landing.includes('Bring your own AI endpoints'), 'Door 1 subtitle')
  assert.ok(landing.includes('Browse and use AI models'), 'Door 2 subtitle')
  assert.ok(landing.includes('Connect your own AI endpoints'), 'Door 1 feature list')
  assert.ok(landing.includes('OAuth connect'), 'Door 1 mentions OAuth connect')
  assert.ok(landing.includes('Chat directly from browser'), 'Door 2 mentions browser chat')
  assert.ok(landing.includes('Pool billing, failover included'), 'Door 2 mentions pool billing')
})

test('landing page redirects signed-in users to /dashboard', () => {
  const landing = read('./src/pages/Landing.tsx')
  assert.ok(landing.includes('const { user, loading } = useAuth()'), 'reads the session')
  assert.ok(landing.includes('if (user && !loading)'), 'checks for an authenticated user')
  assert.ok(landing.includes('<Navigate to="/dashboard" replace />'), 'redirects to /dashboard via router (no location.href)')
})

test('landing page is responsive and interactive', () => {
  const landing = read('./src/pages/Landing.tsx')
  assert.ok(landing.includes('grid md:grid-cols-2'), 'two columns at md+, one on mobile')
  assert.ok(landing.includes('hover:scale-[1.02]'), 'cards have hover feedback')
  assert.ok(landing.includes('transition-all'), 'hover is animated')
})

test('landing page carries the support contact', () => {
  const landing = read('./src/pages/Landing.tsx')
  assert.ok(landing.includes('help@freellm.hasit.in'), 'support email is present')
  assert.ok(landing.includes('mailto:help@freellm.hasit.in'), 'support email is a mailto link')
  assert.ok(landing.includes('Need help?'), 'support line is labelled')
})

test('landing page is routed as the app root', () => {
  const app = read('./src/App.tsx')
  assert.ok(/path="\/"\s+element=\{<Landing \/>\}/.test(app), '/ renders Landing')
  assert.ok(app.includes("import Landing from './pages/Landing'"), 'Landing is imported')
})
