// Sanity checks for the mobile navigation: the bottom tab bar and the
// hamburger drawer. Verifies the destinations, touch-target sizes, ARIA
// wiring, and responsive visibility classes that make the nav usable on a
// phone without regressing the desktop top nav.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (p: string) => require('fs').readFileSync(p, 'utf8')

const bottomNav = read('./src/components/nav/MobileBottomNav.tsx')
const mobileMenu = read('./src/components/nav/MobileMenu.tsx')
const appShell = read('./src/components/AppShell.tsx')

test('mobile bottom nav: five core tabs, all thumb-reachable', () => {
  for (const to of ['/dashboard', '/chat', '/keys', '/earn', '/models']) {
    assert.ok(bottomNav.includes(to), `bottom nav links to ${to}`)
  }
  // Fixed bottom, full-width, 56px rows — above the 44px minimum.
  assert.ok(bottomNav.includes('fixed inset-x-0 bottom-0'), 'bar is pinned to the bottom')
  assert.ok(bottomNav.includes('min-h-[56px]'), 'each tab is ≥56px tall')
  // Hidden on desktop — the top nav owns md+ screens.
  assert.ok(bottomNav.includes('md:hidden'), 'bottom nav is mobile-only')
  assert.ok(!bottomNav.includes('/battle'), 'Battle stays in the drawer, not a tab')
  assert.ok(!bottomNav.includes('/developers'), 'API docs stays in the drawer, not a tab')
})

test('mobile bottom nav: active state and accessibility', () => {
  assert.ok(bottomNav.includes('aria-label="Primary mobile"'), 'nav is labelled')
  assert.ok(bottomNav.includes('aria-current'), 'active tab exposes aria-current')
  assert.ok(bottomNav.includes('aria-hidden="true"'), 'decorative icons are hidden from AT')
  // Icons render filled+stroked-off when active — a visual active cue beyond color.
  assert.ok(bottomNav.includes('isActive ? \'text-accent\''), 'active tab is accent-coloured')
})

test('mobile bottom nav: hidden for signed-out visitors', () => {
  assert.ok(bottomNav.includes('if (!user) return null'), 'no tab bar without a session')
})

test('mobile drawer: secondary destinations and account controls', () => {
  for (const to of ['/developers', '/usage', '/admin']) {
    assert.ok(mobileMenu.includes(to), `drawer links to ${to}`)
  }
  assert.ok(mobileMenu.includes('help@freellm.hasit.in'), 'drawer surfaces support email')
  assert.ok(mobileMenu.includes('logout'), 'drawer can sign out')
  assert.ok(mobileMenu.includes('user.balance_credits'), 'drawer shows the credit balance')
})

test('mobile drawer: is a proper modal dialog with keyboard escape', () => {
  assert.ok(mobileMenu.includes('aria-modal="true"'), 'drawer is a modal')
  assert.ok(mobileMenu.includes('role="dialog"'), 'drawer has dialog role')
  assert.ok(mobileMenu.includes("e.key === 'Escape'"), 'Escape closes the drawer')
  assert.ok(mobileMenu.includes('aria-label="Close menu"'), 'close button is labelled')
})

test('mobile drawer: touch targets meet the 44px minimum', () => {
  assert.ok(mobileMenu.includes('min-h-[56px]'), 'drawer rows are ≥56px')
  assert.ok(mobileMenu.includes('min-h-[44px]'), 'drawer buttons are ≥44px')
  assert.ok(mobileMenu.includes('min-w-[44px]'), 'close button is ≥44px wide')
})

test('app shell: desktop nav and mobile controls are mutually exclusive', () => {
  // Desktop top nav: hidden below md.
  assert.ok(appShell.includes('hidden max-w-full flex-1 items-center gap-1'), 'desktop nav container exists')
  assert.ok(/\bmd:flex\b/.test(appShell), 'desktop nav shows at md+')
  // Hamburger: mobile-only.
  assert.ok(appShell.includes('md:hidden'), 'hamburger is mobile-only')
  assert.ok(appShell.includes('aria-label="Open menu"'), 'hamburger is labelled')
  assert.ok(appShell.includes('aria-controls="mobile-menu"'), 'hamburger controls the drawer')
  assert.ok(appShell.includes('aria-expanded={menuOpen}'), 'hamburger reports expanded state')
  // Bottom padding so the fixed tab bar never covers page content.
  assert.ok(appShell.includes('pb-[calc(5rem_+_env(safe-area-inset-bottom))] md:pb-6'), 'main leaves room for the bottom bar (plus safe-area inset)')
})

test('app shell: still renders every primary destination on desktop', () => {
  for (const label of ['Dashboard', 'Chat', 'Your Keys', 'Earn', 'Models', 'API']) {
    assert.ok(appShell.includes(`label: '${label}'`), `top nav keeps ${label}`)
  }
  assert.ok(appShell.includes("user?.role === 'admin'"), 'admin link stays gated by role')
})
