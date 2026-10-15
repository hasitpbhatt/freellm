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
    <main className="min-h-screen bg-white dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Your AI Toolkit
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300">
            Connect, manage, and use AI endpoints your way
          </p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Door 1: BYOK Vault */}
          <Link to="/keys" className="block group">
            <Card className="h-full hover:scale-[1.02] transition-all duration-200 border-2 border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-[13px] font-semibold tracking-wide text-blue-700 dark:text-blue-300 uppercase">Door 1: BYOK Vault</h2>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Bring your own AI endpoints
                </p>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm">
                      🔑
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Connect your own AI endpoints
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm">
                      ➕
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Add manually or in bulk
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm">
                      🔄
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      OAuth connect (Codex, Google, etc.)
                    </span>
                  </div>
                </div>
                <button className="w-full mt-6 py-3 bg-blue-600 text-white rounded-lg font-medium group-hover:bg-blue-700 transition-colors">
                  Access Your Vault →
                </button>
              </div>
            </Card>
          </Link>

          {/* Door 2: Model Marketplace */}
          <Link to="/models" className="block group">
            <Card className="h-full hover:scale-[1.02] transition-all duration-200 border-2 border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/20">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-[13px] font-semibold tracking-wide text-green-700 dark:text-green-300 uppercase">Door 2: Model Marketplace</h2>
              </div>
              <div className="p-6">
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  Browse and use AI models
                </p>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-sm">
                      🔍
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Browse 100+ AI models
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-sm">
                      💬
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Chat directly from browser
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-sm">
                      ⚡
                    </div>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Pool billing, failover included
                    </span>
                  </div>
                </div>
                <button className="w-full mt-6 py-3 bg-green-600 text-white rounded-lg font-medium group-hover:bg-green-700 transition-colors">
                  Browse Models →
                </button>
              </div>
            </Card>
          </Link>
        </div>

        {/* Support Section */}
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-gray-100 dark:bg-gray-800 rounded-full">
            <span className="text-gray-600 dark:text-gray-400 text-sm">
              Need help? 
            </span>
            <a 
              href="mailto:help@freellm.hasit.in"
              className="text-blue-600 dark:text-blue-400 font-medium hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted"
              onClick={(e) => e.stopPropagation()}
            >
              help@freellm.hasit.in
            </a>
            <span className="text-gray-600 dark:text-gray-400 text-sm">
              • We usually respond within 2 hours
            </span>
          </div>
        </div>
      </div>
    </main>
  )
}