// Haptics + a horizontal-swipe gesture helper for touch interactions.
// Both are progressive enhancements: on devices without the Vibration API
// (desktop) or when a mouse pointer is used, everything degrades silently.

import { useRef, useState } from 'react'

/** Short vibration pulse for a meaningful action (delete, grant, submit). */
export function haptic(ms = 10): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(ms)
    } catch {
      // Unsupported / blocked by permissions policy — ignore.
    }
  }
}

/** Two quick pulses — used for the destructive-confirm path. */
export function hapticWarning(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([15, 60, 15])
    } catch {
      // ignore
    }
  }
}

export interface SwipeHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
}

interface SwipeOptions {
  /** Horizontal px of travel needed to register a swipe. */
  threshold?: number
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
}

/**
 * Horizontal swipe detection for touch/pen pointers. Returns handlers to
 * spread onto the swipeable element, the live drag offset (for the row's
 * transform), and the settled direction. Mouse pointers are ignored so
 * desktop click behaviour is untouched.
 */
export function useSwipe({ threshold = 72, onSwipeLeft, onSwipeRight }: SwipeOptions): {
  handlers: SwipeHandlers
  deltaX: number
  swiped: 'left' | 'right' | null
} {
  // Kept out of React state on purpose: pointermove fires far faster than
  // renders, and the swipe is a discrete gesture, not continuous UI state.
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  const firedRef = useRef(false)
  const [deltaX, setDeltaX] = useState(0)
  const [swiped, setSwiped] = useState<'left' | 'right' | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    startX.current = e.clientX
    startY.current = e.clientY
    firedRef.current = false
    setSwiped(null)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current == null) return
    const dx = e.clientX - startX.current
    const dy = startY.current == null ? 0 : e.clientY - startY.current
    // Ignore near-vertical drags — those belong to the page scroller.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
      startX.current = null
      setDeltaX(0)
      return
    }
    setDeltaX(dx)
  }

  const onPointerUp = () => {
    if (startX.current == null) return
    const dx = deltaX
    startX.current = null
    setDeltaX(0)
    if (firedRef.current) return
    if (dx <= -threshold && onSwipeLeft) {
      firedRef.current = true
      setSwiped('left')
      onSwipeLeft()
    } else if (dx >= threshold && onSwipeRight) {
      firedRef.current = true
      setSwiped('right')
      onSwipeRight()
    }
  }

  const onPointerCancel = () => {
    startX.current = null
    setDeltaX(0)
    setSwiped(null)
  }

  return {
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    deltaX,
    swiped,
  }
}
