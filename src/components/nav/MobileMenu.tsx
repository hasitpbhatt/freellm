import { useEffect, useRef, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import { Credits } from '../ui'

// Secondary destinations not worth a bottom-tab slot. Grouped so the drawer
// reads as "everything else", with the account controls pinned at the bottom.
const secondaryItems = [
  { to: '/developers', label: 'API', desc: 'OpenAI-compatible endpoint docs' },
  { to: '/usage', label: 'Usage', desc: 'Your request history' },
]

interface MobileMenuProps {
  open: boolean
  onClose: () => void
}

export function MobileMenu({ open, onClose }: MobileMenuProps) {
  const { user, logout } = useAuth()
  const panelRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(open)

  // Keep the panel mounted through the close transition, then unmount.
  useEffect(() => {
    if (open) {
      // oxlint-disable-next-line react/set-state-in-effect -- keep the panel mounted through the close transition
      setMounted(true)
      return
    }
    const t = setTimeout(() => setMounted(false), 200)
    return () => clearTimeout(t)
  }, [open])

  // Escape closes the drawer; focus moves into it on open and back to the
  // trigger on close so keyboard users never get stranded.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!mounted || !user) return null

  return (
    <div className="md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col border-l border-line bg-surface shadow-xl transition-transform duration-200 ease-out outline-none ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex min-h-[56px] items-center justify-between border-b border-line px-4">
          <span className="font-semibold">Menu</span>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-content"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 flex items-center gap-3 rounded-lg bg-surface-2 p-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent font-semibold">
              {user.username.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{user.username}</p>
              <Link to="/earn" onClick={onClose} className="flex min-h-[44px] items-center gap-1 text-[12px] text-muted hover:text-content">
                <span className="text-accent" aria-hidden="true">◇</span>
                <Credits value={user.balance_credits} /> credits
              </Link>
            </div>
          </div>

          <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">More</p>
          <nav aria-label="Secondary">
            <ul className="flex flex-col">
              {secondaryItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `flex min-h-[56px] flex-col justify-center rounded-lg px-3 py-2 transition-colors ${
                        isActive ? 'bg-surface-2 text-content' : 'text-muted hover:bg-surface-2 hover:text-content'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className="text-[13px] font-medium" aria-current={isActive ? 'page' : undefined}>{item.label}</span>
                        <span className="text-[11px] text-muted">{item.desc}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {user.role === 'admin' && (
            <>
              <p className="mb-1 mt-4 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">Operator</p>
              <NavLink
                to="/admin"
                onClick={onClose}
                className={({ isActive }) =>
                  `flex min-h-[56px] flex-col justify-center rounded-lg px-3 py-2 transition-colors ${
                    isActive ? 'bg-surface-2 text-content' : 'text-muted hover:bg-surface-2 hover:text-content'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="text-[13px] font-medium" aria-current={isActive ? 'page' : undefined}>Admin</span>
                    <span className="text-[11px] text-muted">Users, vault, catalog</span>
                  </>
                )}
              </NavLink>
            </>
          )}
        </div>

        <div className="border-t border-line p-4">
          <a
            href="mailto:help@freellm.hasit.in"
            className="flex min-h-[44px] items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted hover:bg-surface-2 hover:text-content"
          >
            <span aria-hidden="true">✉</span> help@freellm.hasit.in
          </a>
          <button
            type="button"
            onClick={() => { onClose(); void logout() }}
            className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted hover:bg-surface-2 hover:text-content"
          >
            <span aria-hidden="true">⏻</span> Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
