import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '../components/ui'
import { GoogleButton } from '../components/GoogleButton'

// Signup is Google-only: the same OAuth flow creates the account on first
// sign-in. A referral code stashed by /r/:code rides along via ?ref=.
export default function Register() {
  const [ref, setRef] = useState<string | null>(null)
  const [referred, setReferred] = useState(false)

  // Pick up a referral code stashed by /r/:code
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
          One click with Google — no password. Start with zero credits, earn them
          by checking in daily, inviting friends, or contributing keys.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <GoogleButton label="Sign up with Google" next="/dashboard" ref={ref} />
        </div>
        <p className="mt-4 text-[13px] text-muted">
          Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>.
        </p>
      </Card>
    </div>
  )
}
