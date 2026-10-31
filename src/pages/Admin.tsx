import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import AdminModels from '../components/AdminModels'
import AdminPromos from '../components/AdminPromos'
import AdminVault from '../components/AdminVault'
import AdminUsers from '../components/AdminUsers'
import AdminEmailBlocks from '../components/AdminEmailBlocks'
import AdminUpstreamProviders from '../components/AdminUpstreamProviders'
import AdminProxies from '../components/AdminProxies'
import AdminAudit from '../components/AdminAudit'

type Tab = 'models' | 'providers' | 'proxies' | 'promos' | 'vault' | 'users' | 'blocks' | 'audit'

const TABS: { id: Tab; label: string }[] = [
  { id: 'models', label: 'Model catalog' },
  { id: 'providers', label: 'Upstream providers' },
  { id: 'proxies', label: 'Proxies' },
  { id: 'promos', label: 'Promo codes' },
  { id: 'vault', label: 'Vault (BYOK)' },
  { id: 'users', label: 'Users' },
  { id: 'blocks', label: 'Email blocks' },
  { id: 'audit', label: 'Audit log' },
]

export default function Admin() {
  const { user, loading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab: Tab =
    rawTab === 'providers' || rawTab === 'proxies' || rawTab === 'promos' || rawTab === 'vault' || rawTab === 'users' || rawTab === 'blocks' || rawTab === 'audit' ? rawTab : 'models'

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
      <div className="-mx-4 overflow-x-auto px-4" role="tablist" aria-label="Admin sections">
        <div className="flex min-w-max items-center gap-1 border-b border-line">
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
      </div>
      <div role="tabpanel">
        {tab === 'models' ? (
          <AdminModels />
        ) : tab === 'providers' ? (
          <AdminUpstreamProviders />
        ) : tab === 'proxies' ? (
          <AdminProxies />
        ) : tab === 'promos' ? (
          <AdminPromos />
        ) : tab === 'vault' ? (
          <AdminVault />
        ) : tab === 'users' ? (
          <AdminUsers />
        ) : tab === 'blocks' ? (
          <AdminEmailBlocks />
        ) : (
          <AdminAudit />
        )}
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
      className={`-mb-px min-h-[44px] whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
        active ? 'border-accent text-content' : 'border-transparent text-muted hover:text-content'
      }`}
    >
      {children}
    </button>
  )
}
