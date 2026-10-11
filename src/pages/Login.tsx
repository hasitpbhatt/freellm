import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card } from '../components/ui'
import { GoogleButton } from '../components/GoogleButton'

function storedRef(): string | null {
  try {
    return localStorage.getItem('freellm_ref')
  } catch {
    return null
  }
}

export default function Login() {
  const [searchParams] = useSearchParams()
  const [ref, setRef] = useState<string | null>(null)

  const redirectTo = searchParams.get('next') ?? '/dashboard'
  // OAuth failures come back as /login?error=… from the Google callback.
  const oauthError = searchParams.get('error')

  useEffect(() => {
    setRef(storedRef())
  }, [])

  return (
    <div className="mx-auto max-w-sm py-12">
      <Card className="p-6">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-[13px] text-muted">
          freellm uses Google sign-in only — no passwords to lose or leak.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          {oauthError && (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
              Google sign-in failed: {decodeURIComponent(oauthError)}. Try again.
            </p>
          )}
          <GoogleButton next={redirectTo} ref={ref} />
          <p className="text-center text-[12px] text-muted">
            New here? The same button creates your account.
          </p>
        </div>
      </Card>
    </div>
  )
}
