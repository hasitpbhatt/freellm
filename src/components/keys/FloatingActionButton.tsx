import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'

interface FloatingActionButtonProps {
  onAddKey: () => void
  onBulkImport: () => void
  onConnectAccount: () => void
}

// The button must clear the fixed bottom tab bar (~56px) plus any safe-area
// inset, or it sits on top of the bar and steals taps meant for the last tab
// ("Models"). On desktop the bar is hidden, so it drops back to bottom-6.
const FAB_POSITION =
  'fixed right-4 bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))] z-50 md:right-6 md:bottom-6'

export function FloatingActionButton({
  onAddKey,
  onBulkImport,
  onConnectAccount,
}: FloatingActionButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Escape closes the menu, matching the mobile drawer's behaviour.
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  const actions = [
    { icon: '📋', label: 'Bulk Import', run: onBulkImport, delay: '50ms' },
    { icon: '🔗', label: 'Connect Account', run: onConnectAccount, delay: '100ms' },
    { icon: '➕', label: 'Add Key', run: onAddKey, delay: '150ms' },
  ]

  return (
    <div className={FAB_POSITION}>
      {/* Tap-away catcher. Transparent, but it sits above the page (the root is
          z-50), so a tap anywhere else — including the tab bar — closes the menu. */}
      {isOpen && (
        <div className="fixed inset-0" onClick={() => setIsOpen(false)} aria-hidden="true" />
      )}
      <div
        id="fab-menu"
        inert={!isOpen}
        aria-hidden={!isOpen}
        className={`absolute right-0 bottom-[calc(100%_+_0.75rem)] z-10 flex flex-col-reverse items-end gap-3 ${
          isOpen ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
      >
        {actions.map((action) => (
          <Button
            key={action.label}
            variant="secondary"
            size="sm"
            onClick={() => {
              action.run()
              setIsOpen(false)
            }}
            className={`min-h-[44px] min-w-[44px] shadow-lg transition-all duration-200 ${
              isOpen ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
            }`}
            style={{ transitionDelay: isOpen ? action.delay : '0ms' }}
            tabIndex={isOpen ? 0 : -1}
          >
            <span aria-hidden="true">{action.icon}</span> {action.label}
          </Button>
        ))}
      </div>
      <Button
        variant="primary"
        size="lg"
        className="relative z-10 w-14 h-14 rounded-full shadow-lg flex items-center justify-center min-h-[56px] min-w-[56px]"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close actions' : 'Add key actions'}
        aria-controls="fab-menu"
      >
        <span aria-hidden="true">{isOpen ? '✕' : '➕'}</span>
      </Button>
    </div>
  )
}
