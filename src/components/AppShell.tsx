import { Link, NavLink, Outlet } from 'react-router-dom'
import { Credits } from '../components/ui'
import { useAuth } from '../lib/auth'

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/chat', label: 'Chat' },
  { to: '/battle', label: 'Battle' },
  { to: '/keys', label: 'Your Keys' },
  { to: '/earn', label: 'Earn' },
  { to: '/models', label: 'Models' },
  { to: '/developers', label: 'API' },
]

export default function AppShell() {
  const { user, loading, logout } = useAuth()

  return (
    <div className="min-h-screen bg-bg">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-20 focus:rounded-md focus:bg-surface-2 focus:px-3 focus:py-1.5 focus:text-[13px]">
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="text-accent" aria-hidden="true">◈</span> freellm
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap items-center gap-1 text-[13px]">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-1.5 transition-colors ${
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
                  `rounded-md px-2.5 py-1.5 transition-colors ${
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
          <div className="ml-auto flex items-center gap-3">
            {loading ? (
              <span className="text-[13px] text-muted" role="status">Checking sign-in…</span>
            ) : user ? (
              <>
                <Link
                  to="/earn"
                  title="Credit balance — earn more on the Earn page"
                  className="flex items-center gap-1.5 text-[13px] hover:text-content"
                >
                  <span className="text-accent" aria-hidden="true">◇</span>
                  <Credits value={user.balance_credits} /> <span className="text-muted">credits</span>
                </Link>
                <span className="text-[13px] text-muted">{user.username}</span>
                <button
                  onClick={() => void logout()}
                  className="text-[13px] text-muted hover:text-content"
                >
                  Sign out
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
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
