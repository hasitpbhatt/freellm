import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { Card } from '../components/ui'

export default function Landing() {
  const { user, loading } = useAuth()

  // If logged in, redirect to Dashboard (Home)
  if (user && !loading) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-content mb-4">
            freellm
          </h1>
          <p className="text-xl text-muted">
            The community-owned arena for indie AI models
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Door 1: BYOK Vault */}
          <Link to="/keys" className="block group">
            <Card className="h-full hover:scale-[1.02] transition-all duration-200 border-2 border-accent/40 bg-surface">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-[13px] font-semibold tracking-wide text-accent uppercase">Door 1: BYOK Vault</h2>
              </div>
              <div className="p-6">
                <p className="text-sm text-muted mb-4">
                  Bring your own AI endpoints
                </p>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center text-white text-sm">
                      🔑
                    </div>
                    <span className="text-sm text-content">
                      Connect your own AI endpoints
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center text-white text-sm">
                      ➕
                    </div>
                    <span className="text-sm text-content">
                      Add manually or in bulk
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center text-white text-sm">
                      🔄
                    </div>
                    <span className="text-sm text-content">
                      OAuth connect (Codex, Google, etc.)
                    </span>
                  </div>
                </div>
                <button className="w-full mt-6 py-3 bg-accent text-white rounded-lg font-medium group-hover:bg-accent-hover transition-colors">
                  Access Your Vault →
                </button>
              </div>
            </Card>
          </Link>

          {/* Door 2: Model Marketplace */}
          <Link to="/models" className="block group">
            <Card className="h-full hover:scale-[1.02] transition-all duration-200 border-2 border-gain/40 bg-surface">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-[13px] font-semibold tracking-wide text-gain uppercase">Door 2: Model Marketplace</h2>
              </div>
              <div className="p-6">
                <p className="text-sm text-muted mb-4">
                  Browse and use AI models
                </p>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gain rounded-full flex items-center justify-center text-white text-sm">
                      🔍
                    </div>
                    <span className="text-sm text-content">
                      Browse AI models in The Pool
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gain rounded-full flex items-center justify-center text-white text-sm">
                      💬
                    </div>
                    <span className="text-sm text-content">
                      Chat directly from browser
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gain rounded-full flex items-center justify-center text-white text-sm">
                      ⚡
                    </div>
                    <span className="text-sm text-content">
                      Pool billing, failover included
                    </span>
                  </div>
                </div>
                <button className="w-full mt-6 py-3 bg-gain text-white rounded-lg font-medium group-hover:opacity-90 transition-colors">
                  Browse Models →
                </button>
              </div>
            </Card>
          </Link>
        </div>

        {/* Support Section */}
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-surface-2 rounded-full">
            <span className="text-muted text-sm">
              Need help?
            </span>
            <a
              href="mailto:help@freellm.hasit.in"
              className="text-accent font-medium hover:text-accent-hover underline decoration-dotted"
              onClick={(e) => e.stopPropagation()}
            >
              help@freellm.hasit.in
            </a>
            <span className="text-muted text-sm">
              • We usually respond within 2 hours
            </span>
          </div>
        </div>
      </div>
    </main>
  )
}