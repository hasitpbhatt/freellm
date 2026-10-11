import { useState } from 'react'
import { useAuth } from '../lib/auth'
import AdminModels from '../components/AdminModels'
import AdminPromos from '../components/AdminPromos'
import AdminVault from '../components/AdminVault'

type Tab = 'models' | 'promos' | 'vault'

export default function Admin() {
  const { user, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<Tab>('models')

  if (authLoading) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>
  if (!user) return null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-1 border-b border-line">
        <TabButton active={tab === 'models'} onClick={() => setTab('models')}>
          Model catalog
        </TabButton>
        <TabButton active={tab === 'promos'} onClick={() => setTab('promos')}>
          Promo codes
        </TabButton>
        <TabButton active={tab === 'vault'} onClick={() => setTab('vault')}>
          Vault (BYOK)
        </TabButton>
      </div>
      {tab === 'models' ? <AdminModels /> : tab === 'promos' ? <AdminPromos /> : <AdminVault />}
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
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
        active ? 'border-accent text-content' : 'border-transparent text-muted hover:text-content'
      }`}
    >
      {children}
    </button>
  )
}