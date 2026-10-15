// The mobile floating "+" button used to sit at bottom-6 (24px), inside the
// fixed bottom tab bar's band (bottom-0, ~56px) — covering the last tab and
// intercepting its taps. These checks pin the layout contract: the button
// clears the bar on mobile, keeps its conventional corner on desktop, and the
// menu it opens is genuinely removed from the tab order when closed.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (p: string) => require('fs').readFileSync(p, 'utf8')

const fab = read('./src/components/keys/FloatingActionButton.tsx')
const nav = read('./src/components/nav/MobileBottomNav.tsx')
const css = read('./src/index.css')

test('floating button clears the bottom tab bar on mobile', () => {
  // Offsets by the bar height (56px) + a gap (16px) = 4.5rem, plus the inset.
  assert.ok(
    fab.includes('bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))]'),
    'FAB is lifted above the tab bar and the safe-area inset on mobile',
  )
  // The old, collision-prone placement must be gone.
  assert.ok(!fab.includes('fixed bottom-6 right-6'), 'FAB no longer sits inside the tab-bar band')
})

test('floating button keeps its conventional corner on desktop', () => {
  // The tab bar is md:hidden, so md+ has no collision and keeps bottom-6.
  assert.ok(fab.includes('md:bottom-6'), 'FAB returns to bottom-6 at md+')
  assert.ok(fab.includes('md:right-6'), 'FAB returns to right-6 at md+')
})

test('the lift offset actually clears the tab bar height', () => {
  const offsetRem = Number(fab.match(/bottom-\[calc\(([\d.]+)rem/)?.[1])
  const barPx = Number(nav.match(/min-h-\[(\d+)px\]/)?.[1])
  assert.ok(Number.isFinite(offsetRem) && Number.isFinite(barPx), 'both dimensions are declared')
  assert.ok(offsetRem * 16 > barPx, `FAB offset ${offsetRem}rem must exceed bar height ${barPx}px`)
})

test('the tab bar respects the device safe-area inset', () => {
  assert.ok(
    nav.includes('pb-[env(safe-area-inset-bottom)]'),
    'tabs are lifted above the iOS home indicator',
  )
})

test('page content clears the taller (inset) bar too', () => {
  const shell = read('./src/components/AppShell.tsx')
  assert.ok(
    shell.includes('pb-[calc(5rem_+_env(safe-area-inset-bottom))] md:pb-6'),
    'main content reserves bar + inset on mobile, and the plain gap on desktop',
  )
})

test('mobile toasts no longer cover the tab bar', () => {
  // The breakout is in the max-width:640px media query.
  const mobile = css.slice(css.indexOf('@media (max-width: 640px)'))
  assert.ok(mobile.includes('env(safe-area-inset-bottom)'), 'mobile toast clears the bar + inset')
  assert.ok(mobile.includes('calc(4.5rem'), 'mobile toast offset uses the bar clearance')
})

test('the open menu is removed from the tab order when closed', () => {
  assert.ok(fab.includes('inert={!isOpen}'), 'collapsed menu is inert (not focusable)')
  assert.ok(fab.includes('aria-hidden={!isOpen}'), 'collapsed menu is hidden from assistive tech')
  assert.ok(fab.includes('tabIndex={isOpen ? 0 : -1}'), 'menu items leave the tab order when closed')
})

test('the menu and its trigger satisfy the ARIA contract', () => {
  assert.ok(fab.includes('id="fab-menu"'), 'the controlled menu carries the referenced id')
  assert.ok(fab.includes('aria-controls="fab-menu"'), 'the trigger points at that id')
  assert.ok(fab.includes('aria-expanded'), 'the trigger reports its state')
  assert.ok(fab.includes("e.key === 'Escape'"), 'Escape closes the menu, like the drawer')
})

test('decorative emoji are hidden from assistive tech', () => {
  // Each icon is wrapped: <span aria-hidden="true">…</span>
  const icons = fab.match(/<span aria-hidden="true">/g) ?? []
  assert.ok(icons.length >= 2, 'menu items and the trigger mark their glyphs aria-hidden')
})
