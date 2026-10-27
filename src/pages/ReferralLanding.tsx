import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

/**
 * /r/:code — referral landing. Stashes the code so signup can attribute
 * it, then sends the visitor into the sign-in flow.
 */
export default function ReferralLanding() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()
  const stored = useRef(false)

  useEffect(() => {
    if (stored.current) return
    stored.current = true
    if (code) {
      try {
        localStorage.setItem('freellm_ref', code.toLowerCase())
      } catch {
        // private mode — attribution just won't persist
      }
    }
    navigate('/login', { replace: true })
  }, [code, navigate])

  return (
    <p className="py-12 text-center text-[13px] text-muted" role="status">
      Applying invite… taking you to sign-in.
    </p>
  )
}
