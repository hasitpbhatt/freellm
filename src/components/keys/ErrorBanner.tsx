import { useEffect } from 'react'

interface ErrorBannerProps {
  message: string
  kind: 'ok' | 'err' | 'warn'
  onDismiss: () => void
}

export function ErrorBanner({ message, kind, onDismiss }: ErrorBannerProps) {
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        onDismiss()
      }, kind === 'err' ? 10000 : 8000)
      return () => clearTimeout(timer)
    }
  }, [message, kind, onDismiss])

  if (!message) return null

  const colors = {
    ok: 'border-gain bg-gain/10 text-gain',
    err: 'border-loss bg-loss/10 text-loss',
    warn: 'border-warn bg-warn/10 text-warn',
  }

  const icons = {
    ok: '✓',
    err: '✕',
    warn: '⚠',
  }

  return (
    <div
      className={`card p-4 animate-slide-down ${colors[kind]}`}
      role={kind === 'err' ? 'alert' : 'status'}
      aria-live={kind === 'err' ? 'assertive' : 'polite'}
    >
      <div className="flex items-start gap-3">
        <span className="font-bold text-lg flex-shrink-0">{icons[kind]}</span>
        <p className="flex-1 text-[13px] leading-relaxed">{message}</p>
        <button
          onClick={onDismiss}
          className="min-h-[44px] min-w-[44px] px-2 text-[12px] text-current/70 hover:text-current transition-colors flex-shrink-0"
          aria-label="Dismiss message"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
