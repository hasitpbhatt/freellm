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
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="text-accent">◈</span> freellm
          </Link>
          <nav className="flex items-center gap-1 text-[13px]">
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
                {item.label}
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
                Admin
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {loading ? null : user ? (
              <>
                <Link to="/earn" className="flex items-center gap-1.5 text-[13px] hover:text-content">
                  <span className="text-accent">◇</span>
                  <Credits value={user.balance_credits} /> <span className="text-muted">cr</span>
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
              <>
                <Link to="/login" className="btn-ghost">
                  Sign in
                </Link>
                <Link to="/register" className="btn-primary">
                  Create account
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
