import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Card } from '../components/ui'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const { refresh } = useAuth()
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working')
  const [message, setMessage] = useState('')
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true
    if (!token) {
      setStatus('error')
      setMessage('No verification token in the link.')
      return
    }
    api
      .post<{ ok: boolean }>('/auth/verify-email', { token })
      .then(async () => {
        setStatus('ok')
        setMessage('Your email is verified — earning is unlocked.')
        await refresh()
      })
      .catch((err: unknown) => {
        setStatus('error')
        setMessage(err instanceof Error ? err.message : 'Verification failed.')
      })
  }, [token, refresh])

  return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-lg font-semibold">
        {status === 'working' ? 'Verifying…' : status === 'ok' ? '✅ Verified' : 'Verification failed'}
      </h1>
      <p className="mt-2 text-[13px] text-muted">{status === 'working' ? 'One moment.' : message}</p>
      <Link to="/earn" className="btn-primary mt-4 inline-block">
        Go to Earn
      </Link>
    </Card>
  )
}
