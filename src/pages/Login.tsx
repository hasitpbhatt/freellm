import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { Card } from '../components/ui'
import { GoogleButton } from '../components/GoogleButton'
import { useAuth } from '../lib/auth'

// The only auth page: Google sign-in creates the account on first use, so
// sign-in and sign-up are the same button. /register redirects here.
export default function Login() {
  const { user, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const [ref, setRef] = useState<string | null>(null)
  const [referred, setReferred] = useState(false)

  const redirectTo = searchParams.get('next') ?? '/dashboard'
  // OAuth failures come back as /login?error=… from the Google callback.
  const rawOAuthError = searchParams.get('error')
  let oauthError: string | null = null
  try {
    oauthError = rawOAuthError ? decodeURIComponent(rawOAuthError) : null
  } catch {
    oauthError = 'Unknown error'
  }

  useEffect(() => {
    try {
      const code = localStorage.getItem('freellm_ref')
      if (code) {
        setReferred(true)
        setRef(code)
      }
    } catch {
      // storage unavailable
    }
  }, [])

  if (!loading && user) {
    return <Navigate to={redirectTo} replace />
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <Card className="p-6">
        <h1 className="text-lg font-semibold">Sign in</h1>
        {referred && (
          <p className="mt-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-[13px] text-accent">
            Referred by a friend — you both earn 500,000 cr once you're active.
          </p>
        )}
        <p className="mt-1 text-[13px] text-muted">
          One click with Google — new here? The same button creates your account. No passwords.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          {oauthError && (
            <p role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
              Google sign-in failed: {oauthError}. Try again.
            </p>
          )}
          <GoogleButton next={redirectTo} ref={ref} />
        </div>
      </Card>
    </div>
  )
}
