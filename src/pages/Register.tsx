import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ApiError } from '../lib/api'
import { Button, Card } from '../components/ui'
import { AuthDivider, GoogleButton } from '../components/GoogleButton'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [referred, setReferred] = useState(false)

  // Pick up a referral code stashed by /r/:code
  useEffect(() => {
    try {
      if (localStorage.getItem('freellm_ref')) setReferred(true)
    } catch {
      // storage unavailable
    }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      let referralCode: string | undefined
      try {
        referralCode = localStorage.getItem('freellm_ref') ?? undefined
      } catch {
        referralCode = undefined
      }
      await register(email, username, password, referralCode)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm py-12">
      <Card className="p-6">
        <h1 className="text-lg font-semibold">Create account</h1>
        {referred && (
          <p className="mt-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-[13px] text-accent">
            Referred by a friend — you both earn 500,000 cr once you're active.
          </p>
        )}
        <p className="mt-1 text-[13px] text-muted">
          Start with zero credits — earn them by checking in daily, inviting friends, or contributing keys.
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
          <Field label="Username">
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="indie_hacker"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="at least 8 characters"
            />
          </Field>
          {error && <p className="text-[13px] text-loss">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-1 w-full">
            {busy ? 'Creating…' : 'Create account'}
          </Button>
          <AuthDivider />
          <GoogleButton next="/dashboard" />
        </form>
        <p className="mt-4 text-[13px] text-muted">
          Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>.
        </p>
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
