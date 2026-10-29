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
    <main className="min-h-screen bg-bg flex flex-col">
      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center pt-10 pb-6 px-4 text-center">
        <h1 className="text-4xl font-bold text-content mb-4 tracking-tight">
          freellm
        </h1>
        <p className="text-xl text-muted mb-8 max-w-2xl mx-auto leading-relaxed">
          The community-owned arena for indie AI models. Bring your own key and chat free forever,
          or spend earned credits on <span className="text-content font-medium">The Pool</span> — models kept
          alive by contributors. 1 credit = 1 token.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/chat" className="btn-primary px-8 py-3 text-sm font-medium">
            Try a free chat →
          </Link>
          <Link to="/keys" className="btn-secondary px-8 py-3 text-sm font-medium">
            Start with Your Key →
          </Link>
          <Link to="/models" className="btn-secondary px-8 py-3 text-sm font-medium">
            Browse The Pool →
          </Link>
        </div>
      </section>

      {/* Two doors */}
      <section className="border-t border-line bg-surface/30">
        <div className="mx-auto max-w-4xl px-4 py-12">
          <div className="grid md:grid-cols-2 gap-8">
            {/* Door 1: BYOK Vault */}
            <Link to="/keys" className="block group">
              <Card className="h-full hover:scale-[1.02] transition-all duration-200 border-2 border-accent/40 bg-surface group-hover:border-accent/60">
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                  <h2 className="text-[13px] font-semibold tracking-wide text-accent uppercase">
                    Door 1: BYOK Vault
                  </h2>
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
              <Card className="h-full hover:scale-[1.02] transition-all duration-200 border-2 border-gain/40 bg-surface group-hover:border-gain/60">
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                  <h2 className="text-[13px] font-semibold tracking-wide text-gain uppercase">
                    Door 2: Model Marketplace
                  </h2>
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
        </div>
      </section>

      {/* How you earn — no games, real contribution */}
      <section className="border-t border-line bg-bg">
        <div className="mx-auto max-w-4xl px-4 py-16">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-content mb-3">How you earn credits</h2>
            <p className="text-muted max-w-lg mx-auto">
              No arcade, no gimmicks. Earn by using and contributing to the product itself.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="card p-6 text-center">
              <div className="text-accent text-2xl mb-3" aria-hidden="true">🔥</div>
              <h3 className="font-semibold text-content mb-2">Daily check-in</h3>
              <p className="text-muted text-[13px] leading-relaxed">
                Check in every day: +50,000 credits base, with streak bonuses at 7 and 30 days.
                Verify your email to start.
              </p>
            </div>
            <div className="card p-6 text-center">
              <div className="text-gain text-2xl mb-3" aria-hidden="true">🤝</div>
              <h3 className="font-semibold text-content mb-2">Refer a friend</h3>
              <p className="text-muted text-[13px] leading-relaxed">
                Send your referral link. When a friend checks in for 7 days or uses 200,000 tokens,
                you get +500,000 credits.
              </p>
            </div>
            <div className="card p-6 text-center">
              <div className="text-accent text-2xl mb-3" aria-hidden="true">🔌</div>
              <h3 className="font-semibold text-content mb-2">Contribute keys</h3>
              <p className="text-muted text-[13px] leading-relaxed">
                Share your keys with The Pool. You earn when the community uses them — your keys,
                your terms, your rewards.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Support Section */}
      <section className="bg-surface/30 border-t border-line">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center">
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
      </section>
    </main>
  )
}