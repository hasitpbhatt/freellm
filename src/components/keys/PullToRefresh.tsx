import { useRef, useState, type ReactNode } from 'react'
import { haptic } from '../../lib/useHaptics'

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void
  children: ReactNode
}

/**
 * Pull-to-refresh wrapper for touch devices. Drag the content down past the
 * threshold and release to re-run the refresh callback. Desktop users never
 * see it (mouse pointers are ignored) and the page scroller is never hijacked:
 * the gesture only engages when the container is already scrolled to the top.
 */
export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const start = useRef<{ y: number; engaged: boolean } | null>(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const THRESHOLD = 70
  const MAX_PULL = 120

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || refreshing) return
    const target = e.currentTarget as HTMLElement
    // Only engage at the very top of the page — otherwise let the scroller win.
    if (target.scrollTop > 0) return
    start.current = { y: e.clientY, engaged: true }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current?.engaged) return
    const dy = e.clientY - start.current.y
    if (dy <= 0) {
      setPull(0)
      return
    }
    // Rubber-band: the further you pull, the less it moves.
    const eased = Math.min(MAX_PULL, dy * 0.5)
    setPull(eased)
  }

  const onPointerUp = async () => {
    if (!start.current?.engaged) return
    const shouldRefresh = pull >= THRESHOLD
    start.current = null
    if (!shouldRefresh) {
      setPull(0)
      return
    }
    haptic()
    setRefreshing(true)
    setPull(THRESHOLD)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
      setPull(0)
    }
  }

  const armed = pull >= THRESHOLD

  return (
    <div
      className="relative"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { start.current = null; setPull(0) }}
    >
      {/* Spinner / hint revealed by the drag */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center overflow-hidden transition-[height] duration-100"
        style={{ height: refreshing ? THRESHOLD : pull }}
        aria-hidden={pull === 0 && !refreshing}
      >
        <div className="flex items-center gap-2 pt-2 text-[12px] text-muted">
          {refreshing ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
              Refreshing…
            </>
          ) : (
            <span className={`transition-transform ${armed ? 'rotate-180 text-accent' : ''}`}>↓</span>
          )}
        </div>
      </div>
      <div style={{ transform: pull ? `translateY(${pull}px)` : undefined, transition: pull ? 'none' : 'transform 0.18s ease-out' }}>
        {children}
      </div>
      {/* Announce the result for screen readers — the spinner alone is silent. */}
      <div className="sr-only" role="status" aria-live="polite">
        {refreshing ? 'Refreshing keys' : ''}
      </div>
    </div>
  )
}
