import { useRef, useState } from 'react'
import { Button } from '../../components/ui'
import { Link } from 'react-router-dom'
import type { ByokKey } from '../../pages/Keys'
import { haptic, hapticWarning } from '../../lib/useHaptics'

interface KeyCardProps {
  keyData: ByokKey
  isExpanded: boolean
  onToggleExpand: () => void
  onTest: () => void
  onRefresh: () => void
  onDelete: () => void
  isTesting: boolean
  isAdding: boolean
  isNew: boolean
}

const statusDot: Record<string, string> = {
  live: 'bg-gain',
  slow: 'bg-warn',
  down: 'bg-loss',
  unknown: 'bg-muted',
  disabled: 'bg-muted',
}

const statusLabel: Record<string, string> = {
  live: 'Live',
  slow: 'Slow',
  down: 'Down',
  unknown: 'Unknown',
  disabled: 'Disabled',
}

const SWIPE_THRESHOLD = 72

function formatTime(ts: number | null): string {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleString()
}

function formatLatency(ms: number | null): string {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function KeyCard({
  keyData,
  isExpanded,
  onToggleExpand,
  onTest,
  onRefresh,
  onDelete,
  isTesting,
  isAdding,
  isNew,
}: KeyCardProps) {
  // Touch-only swipe gestures. Swipe left = delete, swipe right = use in chat.
  // The rows reveal the action label under the finger while dragging, then
  // commit on release. Mouse/desktop clicks are unaffected.
  const touch = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false })
  const [dragX, setDragX] = useState(0)
  const [reveal, setReveal] = useState<'none' | 'left' | 'right'>('none')

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || isExpanded) return
    touch.current = { x: e.clientX, y: e.clientY, active: true }
    setReveal('none')
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!touch.current.active) return
    const dx = e.clientX - touch.current.x
    const dy = e.clientY - touch.current.y
    // A mostly-vertical drag belongs to the scroller — abandon the gesture.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
      touch.current.active = false
      setDragX(0)
      setReveal('none')
      return
    }
    const clamped = Math.max(-120, Math.min(120, dx))
    setDragX(clamped)
    setReveal(clamped <= -SWIPE_THRESHOLD ? 'left' : clamped >= SWIPE_THRESHOLD ? 'right' : 'none')
  }

  const onPointerUp = () => {
    if (!touch.current.active) return
    const dx = dragX
    touch.current.active = false
    setDragX(0)
    if (dx <= -SWIPE_THRESHOLD) {
      hapticWarning()
      onDelete()
    } else if (dx >= SWIPE_THRESHOLD) {
      haptic()
      window.location.href = `/chat?mode=byok&key=${keyData.id}`
    }
    setReveal('none')
  }

  const onPointerCancel = () => {
    touch.current.active = false
    setDragX(0)
    setReveal('none')
  }

  const isDown = keyData.status === 'down' || keyData.status === 'disabled'

  return (
    <div className={`card p-3 ${isDown ? 'opacity-70' : ''}`}>
      {/* Swipe hint: the action behind the row, revealed as the finger moves. */}
      {reveal !== 'none' && (
        <div
          className={`pointer-events-none absolute inset-y-0 flex items-center px-4 text-[12px] font-medium ${
            reveal === 'left' ? 'right-0 bg-loss/20 text-loss' : 'left-0 bg-gain/20 text-gain'
          }`}
          aria-hidden="true"
        >
          {reveal === 'left' ? '← Delete' : 'Use in chat →'}
        </div>
      )}
      <div
        className="relative touch-pan-y"
        style={{
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: dragX ? 'none' : 'transform 0.18s ease-out',
          background: 'var(--surface)',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <button
            type="button"
            onClick={() => { haptic(); onToggleExpand() }}
            className="flex items-center gap-2 p-2 rounded hover:bg-surface-2 transition-colors w-full sm:w-auto text-left min-h-[44px]"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${statusDot[keyData.status]}`} />
            <span className="font-medium text-sm">{keyData.label}</span>
            <span className={`num rounded px-2 py-0.5 text-[11px] ${isDown ? 'bg-loss/20 text-loss' : 'bg-gain/20 text-gain'}`}>
              {statusLabel[keyData.status]}
            </span>
            {keyData.auth_kind === 'oauth' && (
              <span className="num rounded bg-surface-2 px-2 py-0.5 text-[10px] text-muted">OAuth</span>
            )}
            {keyData.auth_kind === 'api_key' && (
              <span className="num rounded bg-surface-2 px-2 py-0.5 text-[10px] text-muted">API key</span>
            )}
            {keyData.protocol === 'codex' && (
              <span className="num rounded bg-accent/10 px-2 py-0.5 text-[10px] text-accent">Codex</span>
            )}
            {isNew && (
              <span className="num rounded bg-gain/20 px-2 py-0.5 text-[10px] text-gain">New</span>
            )}
            {keyData.expired && (
              <span className="num rounded bg-loss/20 px-2 py-0.5 text-[10px] text-loss">Expired</span>
            )}
            <span className="num font-mono text-[11px] text-muted">{keyData.key_masked}</span>
            <span className="text-muted">▾</span>
          </button>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { haptic(); onTest() }}
              disabled={isTesting || isAdding}
              className="min-h-[44px] min-w-[44px] flex-1 sm:flex-initial"
            >
              {isTesting ? 'Testing…' : 'Test'}
            </Button>
            {keyData.auth_kind === 'oauth' && keyData.has_refresh_token && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { haptic(); onRefresh() }}
                className="min-h-[44px] min-w-[44px] flex-1 sm:flex-initial"
              >
                Refresh Token
              </Button>
            )}
            <Link
              to={`/chat?mode=byok&key=${keyData.id}`}
              className="btn-secondary btn-sm min-h-[44px] min-w-[44px] flex-1 sm:flex-initial text-center"
            >
              Use in chat
            </Link>
            <Button
              variant="secondary"
              size="sm"
              className="text-loss hover:bg-loss/10 min-h-[44px] min-w-[44px] flex-1 sm:flex-initial"
              onClick={() => { hapticWarning(); onDelete() }}
            >
              Delete
            </Button>
          </div>
        </div>
        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-line space-y-1 text-[12px] text-muted animate-slide-down">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="min-w-0 break-all"><span className="font-medium">Base URL:</span> {keyData.base_url}</div>
              <div className="min-w-0 break-all"><span className="font-medium">Upstream model:</span> <code className="font-mono">{keyData.upstream_model}</code></div>
              {keyData.protocol === 'codex' && <div><span className="font-medium">Protocol:</span> Codex Responses API</div>}
              {keyData.account_id && <div className="min-w-0 break-all"><span className="font-medium">Account ID:</span> <code className="font-mono">{keyData.account_id}</code></div>}
              {keyData.auth_kind === 'oauth' && <div><span className="font-medium">Refresh token:</span> {keyData.has_refresh_token ? 'stored (never shown)' : 'not stored'}</div>}
              {keyData.auth_kind === 'oauth' && <div><span className="font-medium">Expires:</span> {keyData.expires_at ? formatTime(keyData.expires_at) : 'unknown'}</div>}
              <div><span className="font-medium">Latency:</span> {formatLatency(keyData.avg_latency_ms)}</div>
              <div><span className="font-medium">Messages served:</span> {keyData.messages_served}</div>
              <div><span className="font-medium">Added:</span> {formatTime(keyData.created_at)}</div>
              <div><span className="font-medium">Last checked:</span> {formatTime(keyData.last_checked_at)}</div>
              {keyData.last_error && (
                <div className="min-w-0 break-all sm:col-span-2 text-loss"><span className="font-medium">Last error:</span> {keyData.last_error}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
