import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import AdminModels from '../components/AdminModels'
import AdminPromos from '../components/AdminPromos'
import AdminVault from '../components/AdminVault'

type Tab = 'models' | 'promos' | 'vault'

const TABS: { id: Tab; label: string }[] = [
  { id: 'models', label: 'Model catalog' },
  { id: 'promos', label: 'Promo codes' },
  { id: 'vault', label: 'Vault (BYOK)' },
]

export default function Admin() {
  const { user, loading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: Tab = rawTab === 'promos' || rawTab === 'vault' ? rawTab : 'models'

  if (authLoading) return <p className="py-12 text-center text-[13px] text-muted" role="status">Checking admin access…</p>
  if (!user) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-[13px] text-muted">Sign in as an admin to open this console.</p>
        <Link to="/login" className="btn-primary mt-4 inline-block">Sign in</Link>
      </div>
    )
  }
  if (user.role !== 'admin') {
    return <p className="py-12 text-center text-[13px] text-loss" role="alert">Admin access required.</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-1 border-b border-line" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <TabButton
            key={t.id}
            active={tab === t.id}
            onClick={() => {
              setSearchParams(t.id === 'models' ? {} : { tab: t.id }, { replace: true })
            }}
          >
            {t.label}
          </TabButton>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'models' ? <AdminModels /> : tab === 'promos' ? <AdminPromos /> : <AdminVault />}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
        active ? 'border-accent text-content' : 'border-transparent text-muted hover:text-content'
      }`}
    >
      {children}
    </button>
  )
}
