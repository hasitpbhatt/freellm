import { useState } from 'react'

// "Continue with Google" — a plain link to the server-side OAuth entry point
// (/api/auth/google), which stores the state + desired destination in KV and
// 302s to Google. The callback lands back with the session cookie set.

export function GoogleButton({
  label = 'Continue with Google',
  next,
  referral,
}: {
  label?: string
  /** Where to land after a successful callback. Must be a same-site path. */
  next?: string
  /** Referral code to attribute if this sign-in creates the account. */
  referral?: string | null
}) {
  const [navigating, setNavigating] = useState(false)
  const safeNext = next && /^\/[^/\\]/.test(next) ? next : null
  const safeRef = referral && /^[a-z0-9]{2,32}$/i.test(referral) ? referral.toLowerCase() : null
  const params = new URLSearchParams()
  if (safeNext) params.set('next', safeNext)
  if (safeRef) params.set('ref', safeRef)
  const query = params.toString()
  const href = query ? `/api/auth/google?${query}` : '/api/auth/google'
  // NOTE: href stays put during the navigating state. An earlier version
  // swapped href to undefined on click for feedback, which cancelled the
  // browser's default navigation — the button stuck on "Opening Google…"
  // and never left the page.
  return (
    <a
      href={href}
      onClick={() => setNavigating(true)}
      title="Leaves freellm for Google sign-in, then returns here"
      className={`btn-secondary flex w-full items-center justify-center gap-2.5 ${navigating ? 'opacity-60' : ''}`}
    >
      <svg aria-hidden="true" viewBox="0 0 48 48" className="h-4 w-4">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.14.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.92 7.53 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
      {navigating ? 'Opening Google…' : label}
    </a>
  )
}

/** The "or" rule used between stacked auth actions. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-line" />
      <span className="text-[11px] uppercase tracking-wide text-muted">or</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}
