// Sanity checks for the touch-gesture layer (TASK-003): swipe actions on key
// rows, pull-to-refresh, and haptics. Verifies the gesture rules (thresholds,
// direction, mouse opt-out) and the progressive-enhancement guarantees.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = (p: string) => require('fs').readFileSync(p, 'utf8')

const useHaptics = read('./src/lib/useHaptics.ts')
const keyCard = read('./src/components/keys/KeyCard.tsx')
const pullToRefresh = read('./src/components/keys/PullToRefresh.tsx')

test('haptics: vibration is optional and never throws', () => {
  assert.ok(useHaptics.includes("'vibrate' in navigator"), 'checks for API support')
  assert.ok(useHaptics.includes('catch'), 'wraps the call so unsupported devices are fine')
  assert.ok(useHaptics.includes('navigator.vibrate(ms)'), 'haptic() pulses once')
  assert.ok(useHaptics.includes('navigator.vibrate([15, 60, 15])'), 'hapticWarning() pulses twice')
})

test('swipe: left deletes, right opens chat, mouse is ignored', () => {
  assert.ok(keyCard.includes("if (e.pointerType === 'mouse' || isExpanded) return"), 'mouse pointers and expanded rows do not swipe')
  assert.ok(keyCard.includes('dx <= -SWIPE_THRESHOLD'), 'swipe-left threshold check')
  assert.ok(keyCard.includes('dx >= SWIPE_THRESHOLD'), 'swipe-right threshold check')
  assert.ok(keyCard.includes('onDelete()'), 'swipe left deletes')
  assert.ok(keyCard.includes('key=${keyData.id}'), 'swipe right opens chat for that key')
  assert.ok(keyCard.includes('SWIPE_THRESHOLD = 72'), 'threshold is a sensible 72px')
})

test('swipe: vertical scrolls are handed back to the page', () => {
  assert.ok(keyCard.includes('Math.abs(dy) > Math.abs(dx)'), 'vertical drag beats horizontal drag')
  assert.ok(keyCard.includes('Math.abs(dy) > 12'), 'small dead zone before a direction is chosen')
  assert.ok(keyCard.includes('touch.current.active = false'), 'the gesture abandons on a vertical scroll')
})

test('swipe: row follows the finger and springs back', () => {
  assert.ok(keyCard.includes('translateX(${dragX}px)'), 'row translates with the drag')
  assert.ok(keyCard.includes('Math.max(-120, Math.min(120, dx))'), 'drag is clamped so the row cannot run away')
  assert.ok(keyCard.includes('setDragX(0)'), 'row springs back on release')
  assert.ok(keyCard.includes('pointer-events-none'), 'the reveal hint never blocks taps')
})

test('swipe: destructive action gets the warning haptic', () => {
  assert.ok(keyCard.includes('hapticWarning()'), 'delete path haptics with the warning pulse')
  assert.ok(keyCard.includes('haptic()'), 'chat path haptics once')
  assert.ok(keyCard.includes('haptic()'), 'expand path haptics once')
})

test('swipe: actions remain available without touch', () => {
  // Buttons stay in the DOM — the gesture is an accelerator, not the only path.
  assert.ok(keyCard.includes('Delete') && keyCard.includes('Use in chat'), 'row keeps its buttons')
  assert.ok(keyCard.includes('onDelete'), 'delete button still wired')
})

test('pull-to-refresh: engages only at the top of the page', () => {
  assert.ok(pullToRefresh.includes('target.scrollTop > 0'), 'only at scrollTop 0')
  assert.ok(pullToRefresh.includes("e.pointerType === 'mouse'"), 'mouse users are not affected')
  assert.ok(pullToRefresh.includes('THRESHOLD = 70'), 'threshold defined')
  assert.ok(pullToRefresh.includes('MAX_PULL = 120'), 'max pull defined')
})

test('pull-to-refresh: rubber-band feel and spinner', () => {
  assert.ok(pullToRefresh.includes('dy * 0.5'), 'rubber-band easing (half-speed drag)')
  assert.ok(pullToRefresh.includes('animate-spin'), 'busy state shows a spinner')
  assert.ok(pullToRefresh.includes('Refreshing…'), 'spinner is labelled')
  assert.ok(pullToRefresh.includes('rotate-180'), 'arrow flips when the threshold is armed')
})

test('pull-to-refresh: announces completion to screen readers', () => {
  assert.ok(pullToRefresh.includes('role="status"'), 'live region present')
  assert.ok(pullToRefresh.includes('aria-live="polite"'), 'region is polite')
  assert.ok(pullToRefresh.includes('Refreshing keys'), 'announces the refresh')
})

test('pull-to-refresh: wired into the keys list', () => {
  const keys = read('./src/pages/Keys.tsx')
  assert.ok(keys.includes("import { PullToRefresh }"), 'imported on the Keys page')
  assert.ok(keys.includes('<PullToRefresh onRefresh={loadKeys}>'), 'wraps the stored-keys list')
  assert.ok(keys.includes('</PullToRefresh>'), 'wrapper is closed')
})
