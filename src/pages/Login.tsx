import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'
import { AuthDivider, GoogleButton } from '../components/GoogleButton'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const redirectTo = searchParams.get('next') ?? '/dashboard'
  // OAuth failures come back as /login?error=… from the Google callback.
  const oauthError = searchParams.get('error')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate(redirectTo, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <Card className="p-6">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-[13px] text-muted">
          No account? <Link to="/register" className="text-accent hover:underline">Create one</Link>.
        </p>
        <form className="mt-5 flex flex-col gap-3" onSubmit={onSubmit}>
          <Field label="Email">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </Field>
          {oauthError && (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
              Google sign-in failed: {decodeURIComponent(oauthError)}. Try again, or use your password.
            </p>
          )}
          {error && <p className="text-[13px] text-loss">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <AuthDivider />
          <GoogleButton next={redirectTo} />
        </form>
      </Card>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  )
}
