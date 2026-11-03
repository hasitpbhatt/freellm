import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { api } from '../lib/api'

/**
 * /r/:code — referral landing. Shows value prop, referrer info, then
 * continues to sign-in with attribution preserved.
 */
export default function ReferralLanding() {
  const { code } = useParams<{ code: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const stored = useRef(false)
  const [referrer, setReferrer] = useState<{ username: string; avatar_url?: string; qualified_count: number } | null>(null)

  useEffect(() => {
    if (stored.current) return
    stored.current = true
    if (code) {
      try {
        localStorage.setItem('freellm_ref', code.toLowerCase())
      } catch {
        // private mode — attribution just won't persist
      }
      // Fetch referrer profile for social proof
      api.get<{ username: string; avatar_url?: string; qualified_count: number }>(`/referrers/${code.toLowerCase()}/profile`)
        .then(setReferrer)
        .catch(() => {})
    }
    // Don't navigate immediately — let user see the landing page
    // Navigation happens via CTA click
  }, [code])

  const handleContinue = () => {
    const next = searchParams.get('next') ?? '/dashboard'
    navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true })
  }

  const pageTitle = referrer
    ? `Join @${referrer.username} on freellm — Free AI chat + earn credits`
    : 'Join freellm — Free AI chat + earn credits'
  const pageDesc = 'Free AI models, daily check-in rewards, arcade games, and referral bonuses. Bring your own keys — always free.'
  const pageImage = '/og-referral.svg'

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDesc} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDesc} />
        <meta property="og:image" content={pageImage} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDesc} />
        <meta name="twitter:image" content={pageImage} />
      </Helmet>

      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <svg width="48" height="48" viewBox="0 0 48 48" className="mx-auto mb-4 text-accent" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2"/>
              <path d="M16 24l6 6 12-12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h1 className="text-2xl font-bold">Free AI chat + earn credits</h1>
            <p className="mt-2 text-muted">Bring your own keys — always free</p>
          </div>

          {referrer && (
            <div className="card p-4 mb-6 text-center border-accent/30 bg-accent/5">
              <div className="flex items-center justify-center gap-3 mb-3">
                {referrer.avatar_url && (
                  <img src={referrer.avatar_url} alt="" className="w-10 h-10 rounded-full" />
                )}
                <div className="text-left">
                  <p className="font-medium">@{referrer.username} invited you</p>
                  <p className="text-[12px] text-muted">{referrer.qualified_count} friends already joined</p>
                </div>
              </div>
            </div>
          )}

          <div className="card p-6 space-y-4">
            <ul className="text-left space-y-3 text-sm" role="list">
              <li className="flex items-center gap-2">
                <span className="shrink-0 text-gain" aria-hidden="true">✓</span>
                <span>Bring your own API keys — always free</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 text-gain" aria-hidden="true">✓</span>
                <span>Daily check-in: +50,000 credits (streak bonuses at day 7/30)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 text-gain" aria-hidden="true">✓</span>
                <span>Arcade games: up to 61,000 credits/day for skill</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 text-gain" aria-hidden="true">✓</span>
                <span>You both earn: 500,000 credits when you qualify (7-day streak or 200k Pool tokens)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="shrink-0 text-gain" aria-hidden="true">✓</span>
                <span>You get: 50,000 credits on signup + milestones along the way</span>
              </li>
            </ul>

            <button
              onClick={handleContinue}
              className="w-full btn-primary py-3 text-base font-medium mt-2"
              type="button"
            >
              Continue with Google →
            </button>
            <p className="text-center text-xs text-muted">No password. One click.</p>
          </div>
        </div>
      </div>
    </>
  )
}