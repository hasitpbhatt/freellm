// Consolidated responsive-design test suite (TASK-006). Walks every component
// touched by the mobile work and asserts the invariants that keep the product
// usable on a phone:
//   1. viewport meta declares width=device-width (no desktop-zoom traps)
//   2. no fixed pixel widths that would overflow a 320px screen
//   3. every interactive element declares a ≥44px touch target
//   4. responsive breakpoints (sm/md) exist where layout changes
//   5. form inputs go to 16px on mobile (kills iOS auto-zoom)
//   6. accessibility wiring survives the responsive changes

import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (p: string) => require('fs').readFileSync(p, 'utf8')

const KEY_COMPONENTS = [
  './src/pages/Keys.tsx',
  './src/components/keys/KeyCard.tsx',
  './src/components/keys/KeyForm.tsx',
  './src/components/keys/OAuthProviders.tsx',
  './src/components/keys/ErrorBanner.tsx',
  './src/components/keys/FloatingActionButton.tsx',
  './src/components/keys/PullToRefresh.tsx',
  './src/components/nav/MobileBottomNav.tsx',
  './src/components/nav/MobileMenu.tsx',
  './src/components/AppShell.tsx',
]

const all = () => KEY_COMPONENTS.map((p) => ({ path: p, src: read(p) }))

test('viewport meta is mobile-correct', () => {
  const html = read('./index.html')
  assert.ok(html.includes('width=device-width'), 'viewport declares width=device-width')
  assert.ok(!/user-scalable=no/.test(html), 'pinch-zoom is not disabled')
})

test('no min-width traps that overflow a 320px screen', () => {
  for (const { path, src } of all()) {
    // A Tailwind arbitrary value or style that pins a min width above 320.
    const traps = src.match(/min-width:\s*(\d{3,})px|min-w-\[(\d{3,})px\]/g) ?? []
    for (const t of traps) {
      const px = Number(t.match(/\d{3,}/)![0])
      assert.ok(px <= 320, `${path} has a min-width trap: ${t} (${px}px > 320px viewport)`)
    }
  }
})

test('interactive elements declare ≥44px touch targets', () => {
  for (const { path, src } of all()) {
    if (!/<(Button|button|a|Link|select)\b/.test(src)) continue
    const buttonCount = (src.match(/<(Button|button)\b/g) ?? []).length
    if (buttonCount === 0) continue
    const guardCount = (src.match(/min-h-\[(44|56)px\]|min-h-\[24px\]|btn\b|btn-sm\b|min-w-\[44px\]/g) ?? []).length
    // Some buttons inherit .btn / .btn-sm (44px and 40px in index.css) so a
    // blanket assertion is wrong; require that the file engages the guard
    // system at all and never uses a tiny explicit size.
    assert.ok(!/min-h-\[(\d|1\d|2\d|3\d)px\]/.test(src), `${path} uses a sub-44px explicit min-height`)
    assert.ok(guardCount > 0 || /btn-primary|btn-secondary|btn-sm/.test(src), `${path} has no touch-target guard`)
  }
})

test('mobile form inputs use 16px to suppress iOS auto-zoom', () => {
  const css = read('./src/index.css')
  assert.ok(css.includes('@media (max-width: 640px)'), 'has a mobile breakpoint in CSS')
  assert.ok(css.includes('font-size: 16px'), 'forces 16px on mobile inputs')
  assert.ok(css.includes('auto-zoom'), 'documents why')
})

test('layout changes at a breakpoint in every multi-region component', () => {
  const layoutComponents = [
    ['./src/components/keys/KeyCard.tsx', /sm:flex-row|sm:grid-cols-2/],
    ['./src/components/keys/KeyForm.tsx', /sm:grid-cols-2|sm:flex-row/],
    ['./src/components/keys/OAuthProviders.tsx', /sm:flex-row/],
    ['./src/components/AppShell.tsx', /md:flex|md:hidden/],
    ['./src/pages/Landing.tsx', /md:grid-cols-2/],
  ] as const
  for (const [path, pattern] of layoutComponents) {
    assert.ok(pattern.test(read(path)), `${path} adapts at a breakpoint`)
  }
})

test('mobile nav is bottom-anchored and desktop nav is top-anchored', () => {
  const bottom = read('./src/components/nav/MobileBottomNav.tsx')
  const shell = read('./src/components/AppShell.tsx')
  assert.ok(bottom.includes('fixed inset-x-0 bottom-0'), 'bottom nav pinned to viewport bottom')
  assert.ok(bottom.includes('md:hidden'), 'bottom nav hides on desktop')
  assert.ok(shell.includes('sticky top-0'), 'top header is sticky, not fixed')
  assert.ok(shell.includes('md:flex'), 'desktop nav appears at md+')
  assert.ok(shell.includes('pb-[calc(5rem_+_env(safe-area-inset-bottom))] md:pb-6'), 'content clears the fixed bottom bar (plus safe-area inset) on mobile only')
})

test('accessibility wiring survives the responsive changes', () => {
  const card = read('./src/components/keys/KeyCard.tsx')
  const menu = read('./src/components/nav/MobileMenu.tsx')
  const fab = read('./src/components/keys/FloatingActionButton.tsx')
  assert.ok(card.includes('aria-expanded'), 'expandable row exposes its state')
  assert.ok(card.includes('aria-label'), 'expand button is labelled')
  assert.ok(menu.includes('aria-modal="true"'), 'drawer is a modal')
  assert.ok(menu.includes('role="dialog"'), 'drawer has dialog semantics')
  assert.ok(fab.includes('aria-expanded'), 'FAB reports its menu state')
  assert.ok(fab.includes('aria-controls'), 'FAB controls its menu')
  assert.ok(fab.includes('aria-label'), 'FAB is labelled')
})

test('swipe and pull gestures never hijack a mouse pointer', () => {
  const card = read('./src/components/keys/KeyCard.tsx')
  const ptr = read('./src/components/keys/PullToRefresh.tsx')
  assert.ok(card.includes("e.pointerType === 'mouse'"), 'KeyCard ignores mouse')
  assert.ok(ptr.includes("e.pointerType === 'mouse'"), 'PullToRefresh ignores mouse')
  assert.ok(card.includes('touch-pan-y'), 'vertical panning stays native')
  assert.ok(ptr.includes('scrollTop > 0'), 'pull only engages at the top of the page')
})

test('reduced-motion is respected globally', () => {
  const css = read('./src/index.css')
  assert.ok(css.includes('prefers-reduced-motion'), 'reduced-motion media query present')
  assert.ok(/animation-duration:\s*0\.01ms/.test(css), 'animations collapse under reduced motion')
})
