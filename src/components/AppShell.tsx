import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { Credits } from '../components/ui'
import { useAuth } from '../lib/useAuth'
import { MobileBottomNav } from './nav/MobileBottomNav'
import { MobileMenu } from './nav/MobileMenu'

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/chat', label: 'Chat' },
  { to: '/keys', label: 'Your Keys' },
  { to: '/earn', label: 'Earn' },
  { to: '/models', label: 'Models' },
  { to: '/developers', label: 'API' },
]

export default function AppShell() {
  const { user, loading, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-bg">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-20 focus:rounded-md focus:bg-surface-2 focus:px-3 focus:py-1.5 focus:text-[13px]">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex min-h-[48px] max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1">
          <Link to="/" className="flex min-h-[44px] items-center gap-2 font-semibold">
            <span className="text-accent" aria-hidden="true">◈</span> freellm
          </Link>
          {/* Desktop: horizontal top nav. Mobile: the hamburger + bottom tabs below. */}
          <nav aria-label="Primary" className="-mx-1 hidden max-w-full flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap px-1 text-[13px] [scrollbar-width:thin] md:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-2.5 transition-colors ${
                    isActive ? 'bg-surface-2 text-content' : 'text-muted hover:text-content'
                  }`
                }
              >
                {({ isActive }) => (
                  <span aria-current={isActive ? 'page' : undefined}>{item.label}</span>
                )}
              </NavLink>
            ))}
            {user?.role === 'admin' && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-2.5 transition-colors ${
                    isActive ? 'bg-surface-2 text-content' : 'text-muted hover:text-content'
                  }`
                }
              >
                {({ isActive }) => (
                  <span aria-current={isActive ? 'page' : undefined}>Admin</span>
                )}
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex min-h-[44px] items-center gap-3">
            {loading ? (
              <span className="text-[13px] text-muted" role="status">Checking sign-in…</span>
            ) : user ? (
              <>
                <Link
                  to="/earn"
                  title="Credit balance — earn more on the Earn page"
                  className="flex min-h-[44px] items-center gap-1.5 text-[13px] hover:text-content"
                >
                  <span className="text-accent" aria-hidden="true">◇</span>
                  <Credits value={user.balance_credits} /> <span className="hidden text-muted sm:inline">credits</span>
                </Link>
                <span className="hidden text-[13px] text-muted lg:inline">{user.username}</span>
                <button
                  onClick={() => void logout()}
                  className="hidden min-h-[44px] px-1 text-[13px] text-muted hover:text-content md:block"
                >
                  Sign out
                </button>
                {/* Mobile: hamburger opens the drawer with secondary items + account. */}
                <button
                  type="button"
                  onClick={() => setMenuOpen(true)}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-content md:hidden"
                  aria-label="Open menu"
                  aria-expanded={menuOpen}
                  aria-controls="mobile-menu"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                </button>
              </>
            ) : (
              <Link to="/login" className="btn-primary">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-6 pb-[calc(5rem_+_env(safe-area-inset-bottom))] md:pb-6">
        <Outlet />
      </main>
      <MobileBottomNav />
      <div id="mobile-menu">
        <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      </div>
    </div>
  )
}
