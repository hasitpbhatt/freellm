import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { Button, Card, CardHeader } from '../components/ui'
import { KeyCard } from '../components/keys/KeyCard'
import { KeyForm } from '../components/keys/KeyForm'
import { OAuthProviders } from '../components/keys/OAuthProviders'
import { ErrorBanner } from '../components/keys/ErrorBanner'
import { FloatingActionButton } from '../components/keys/FloatingActionButton'
import { PullToRefresh } from '../components/keys/PullToRefresh'

export type ByokKey = {
  id: string
  label: string
  base_url: string
  upstream_model: string
  key_masked: string
  auth_kind: 'api_key' | 'oauth'
  protocol: 'openai' | 'codex'
  account_id: string | null
  has_refresh_token: boolean
  expires_at: number | null
  expired: boolean
  status: 'live' | 'slow' | 'down' | 'unknown' | 'disabled'
  last_checked_at: number | null
  last_error: string | null
  avg_latency_ms: number | null
  messages_served: number
  created_at: number
}

export type KeyTestResult = {
  ok: boolean
  status: 'live' | 'slow' | 'down' | 'unknown' | 'disabled'
  latencyMs: number
  error?: string
}

const STORAGE_KEY = 'freellm:keys:v1'

type PersistedState = { lastAddedId?: string; expandedIds?: string[] }

function loadPersisted(): PersistedState {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function savePersisted(state: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export default function Keys() {
  const { user, loading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [keys, setKeys] = useState<ByokKey[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null)
  const [persisted, setPersisted] = useState<PersistedState>(() => loadPersisted())
  // persisted used for "New" badge on keys
  // persisted is used for "New" badge
  const [expandedIds, setExpandedIds] = useState<string[]>(() => loadPersisted().expandedIds ?? [])
  const [testingId, setTestingId] = useState<string | null>(null)
  const [oauthPolling, setOauthPolling] = useState<Record<string, { state: string; interval: number } | null>>({})
  const [deviceInfo, setDeviceInfo] = useState<{ providerId: string; providerName: string; userCode: string; verificationUri: string } | null>(null)
  const pollStateRef = useRef<Record<string, string>>({})

  const loadKeys = async () => {
    try {
      const data = await api.get<{ keys: ByokKey[] }>('/keys')
      setKeys(data.keys)
    } catch {
      setBanner({ kind: 'err', text: 'Failed to load your keys. Need help? Contact help@freellm.hasit.in' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading) {
      // oxlint-disable-next-line react/set-state-in-effect -- vault load once the session resolves
      void loadKeys()
    }
  }, [authLoading])

  useEffect(() => {
    if (searchParams.get('oauth') === 'success') {
      // oxlint-disable-next-line react/set-state-in-effect -- one-shot banner for the returning PKCE redirect
      setBanner({ kind: 'ok', text: 'Account connected! Key added to your vault.' })
      const next = new URLSearchParams(searchParams)
      next.delete('oauth')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const ref = pollStateRef.current
    return () => {
      for (const key of Object.keys(ref)) delete ref[key]
    }
  }, [])

  useEffect(() => {
    savePersisted({ expandedIds })
  }, [expandedIds])

  const handleAddKey = (key: ByokKey, test: KeyTestResult) => {
    setKeys((prev) => [key, ...prev])
    setPersisted((p) => ({ ...p, lastAddedId: key.id }))
    setBanner({
      kind: test.ok ? 'ok' : 'err',
      text: test.ok ? `Key added and verified ✓${test.latencyMs != null ? ` — ${test.latencyMs}ms` : ''}` : `Key added, but test failed: ${test.error ?? 'unknown error'}`,
    })
  }

  const handleTest = async (id: string) => {
    setBanner(null)
    setTestingId(id)
    try {
      const res = await api.post<{ test: KeyTestResult }>(`/keys/${id}/test`)
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, ...res.test } : k)))
      setBanner({ kind: res.test.ok ? 'ok' : 'err', text: res.test.ok ? 'Key is live ✓' : `Test failed: ${res.test.error}` })
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `Test failed: ${msg}. Need help? Contact help@freellm.hasit.in` })
    } finally {
      setTestingId(null)
    }
  }

  const handleDelete = async (key: ByokKey) => {
    if (!confirm(`Delete key "${key.label}"? Chats using it will need another key. This cannot be undone.`)) return
    try {
      await api.del(`/keys/${key.id}`)
      setKeys((prev) => prev.filter((k) => k.id !== key.id))
      setExpandedIds((prev) => prev.filter((e) => e !== key.id))
      setBanner({ kind: 'ok', text: `Key "${key.label}" deleted.` })
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `Delete failed: ${msg}` })
    }
  }

  const handleRefresh = async (id: string) => {
    setBanner(null)
    try {
      const res = await api.post<{ ok: boolean; expiresAt?: number; message?: string; error?: string }>(`/keys/${id}/refresh`)
      if (res.ok) {
        setBanner({ kind: 'ok', text: res.message || 'Token refreshed successfully' })
        void loadKeys()
      } else {
        setBanner({ kind: 'err', text: res.error || 'Refresh failed' })
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `Refresh failed: ${msg}. Need help? Contact help@freellm.hasit.in` })
    }
  }

  const handleOAuthConnect = async (providerId: string, providerName: string) => {
    setBanner(null)
    setDeviceInfo(null)

    try {
      const res = await api.get<{ authUrl: string; state: string; deviceCode?: string; userCode?: string; verificationUri?: string; verificationUriComplete?: string; interval?: number; expiresIn?: number }>(`/oauth/start/${providerId}`)

      if (res.deviceCode || res.userCode) {
        setOauthPolling((prev) => ({
          ...prev,
          [providerId]: { state: res.state, interval: res.interval || 5 },
        }))
        setDeviceInfo({
          providerId,
          providerName,
          userCode: res.userCode ?? res.deviceCode ?? '',
          verificationUri: res.verificationUriComplete ?? res.verificationUri ?? res.authUrl,
        })
        window.open(res.verificationUriComplete ?? res.verificationUri ?? res.authUrl, '_blank', 'noopener')
        setBanner({ kind: 'ok', text: `${providerName}: enter the code on the opened page, then wait — the key appears below automatically.` })
        pollOAuthToken(providerId, res.state, res.interval || 5)
      } else if (res.authUrl) {
        window.location.assign(res.authUrl)
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setBanner({ kind: 'err', text: `OAuth connect failed: ${msg}` })
    }
  }

  const cancelDeviceFlow = (providerId: string) => {
    delete pollStateRef.current[providerId]
    setOauthPolling((prev) => {
      const next = { ...prev }
      delete next[providerId]
      return next
    })
    setDeviceInfo((prev) => (prev?.providerId === providerId ? null : prev))
  }

  const stopPolling = (providerId: string) => {
    delete pollStateRef.current[providerId]
    setOauthPolling((prev) => {
      const next = { ...prev }
      delete next[providerId]
      return next
    })
  }

  const pollOAuthToken = async (providerId: string, state: string, interval: number) => {
    const maxAttempts = 120
    let attempts = 0
    pollStateRef.current[providerId] = state

    const poll = async () => {
      if (pollStateRef.current[providerId] !== state) return
      if (attempts >= maxAttempts) {
        stopPolling(providerId)
        setDeviceInfo((prev) => (prev?.providerId === providerId ? null : prev))
        setBanner({ kind: 'err', text: 'OAuth authorization timed out.' })
        return
      }

      attempts++

      try {
        const res = await api.post<{ status: string; keyId?: string; error?: string }>(`/oauth/poll/${providerId}`, { state })

        if (pollStateRef.current[providerId] !== state) return

        if (res.status === 'success') {
          stopPolling(providerId)
          setDeviceInfo((prev) => (prev?.providerId === providerId ? null : prev))
          setBanner({ kind: 'ok', text: 'Account connected! Key added to your vault.' })
          void loadKeys()
          return
        }

        if (res.status === 'error') {
          stopPolling(providerId)
          setDeviceInfo((prev) => (prev?.providerId === providerId ? null : prev))
          setBanner({ kind: 'err', text: `OAuth failed: ${res.error}` })
          return
        }

        setTimeout(poll, interval * 1000)
      } catch {
        stopPolling(providerId)
        setDeviceInfo((prev) => (prev?.providerId === providerId ? null : prev))
        setBanner({ kind: 'err', text: 'OAuth polling failed.' })
      }
    }

    await poll()
  }

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id])
  }

  const isExpanded = (id: string) => expandedIds.includes(id)

  const openAddForm = () => setShowAddForm(true)
  const openBulkImport = () => { setShowAddForm(true); }
  const openConnectAccount = () => { document.getElementById('oauth-section')?.scrollIntoView({ behavior: 'smooth' }) }

  if (authLoading) return <div className="py-12 text-center text-[13px] text-muted">Loading…</div>
  if (!user) {
    return (
      <Card className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Your Keys</h1>
        <p className="mt-2 text-[13px] text-muted">
          Sign in to store your own provider keys and chat free.
        </p>
        <div className="mt-4 flex justify-center gap-3">
          <Link to="/login"><Button className="min-h-[44px]">Sign in with Google</Button></Link>
        </div>
      </Card>
    )
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="grid gap-4 lg:max-w-3xl mx-auto p-4">
        <Card className="flex flex-col gap-3 p-6">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <h1 className="text-2xl font-semibold">Your Keys</h1>
            <span className="num text-[13px] text-muted">Door 1 of Two Doors</span>
          </div>
          <p className="text-[13px] text-muted max-w-2xl">
            Bring your own OpenAI-compatible endpoint. Chatting through your key is <strong>free and unmetered</strong> —
            it never touches The Pool. Add each account separately — multiple accounts are allowed, and each stays
            strictly yours (never pooled or shared). Use only tokens from your own provider accounts.
          </p>
          <p className="text-[12px] text-warn">
            ⚠ Security: API keys are stored encrypted and revealable to the operator for auditability.
            OAuth tokens are never revealable — not even to the operator. Do not share your freellm account
            if you use sensitive provider credentials.
          </p>
        </Card>

        <ErrorBanner
          message={banner?.text || ''}
          kind={banner?.kind || 'ok'}
          onDismiss={() => setBanner(null)}
        />

        <Card id="oauth-section">
          <CardHeader title="Connect an account" />
          <div className="p-6 space-y-3">
            <OAuthProviders
              onConnect={handleOAuthConnect}
              isAdding={isAdding}
              pollingProviders={oauthPolling}
              deviceInfo={deviceInfo}
              onCancelDevice={cancelDeviceFlow}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title={showAddForm ? 'Adding key…' : 'Add an API key manually'} />
          {showAddForm ? (
            <KeyForm
              onAddKey={handleAddKey}
              onError={(msg) => setBanner({ kind: 'err', text: msg })}
              onSuccess={(msg) => setBanner({ kind: 'ok', text: msg })}
              isAdding={isAdding}
              setIsAdding={setIsAdding}
            />
          ) : (
            <div className="p-6 text-center">
              <p className="text-[13px] text-muted mb-4">
                Add a single API key or import multiple keys at once.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={openAddForm} className="min-h-[44px] min-w-[44px] flex-1 sm:flex-initial">
                  ➕ Add Single Key
                </Button>
                <Button variant="secondary" onClick={openBulkImport} className="min-h-[44px] min-w-[44px] flex-1 sm:flex-initial">
                  📋 Bulk Import
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Stored keys" />
          {loading ? (
            <div className="p-6 text-center text-[13px] text-muted">Loading keys…</div>
          ) : keys.length === 0 ? (
            <div className="p-6 text-center text-[13px] text-muted">
              No keys yet. Add one above to start chatting for free.
            </div>
          ) : (
            <PullToRefresh onRefresh={loadKeys}>
              <div className="p-4 space-y-3">
                {keys.map((k) => {
                  const isNew = persisted.lastAddedId === k.id
                  return (
                    <KeyCard
                      key={k.id}
                      keyData={k}
                      isExpanded={isExpanded(k.id)}
                      onToggleExpand={() => toggleExpand(k.id)}
                      onTest={() => handleTest(k.id)}
                      onRefresh={() => handleRefresh(k.id)}
                      onDelete={() => handleDelete(k)}
                      isTesting={testingId === k.id}
                      isAdding={isAdding}
                      isNew={isNew}
                    />
                  )
                })}
              </div>
            </PullToRefresh>
          )}
        </Card>

        <Card className="p-4 border-accent/30">
          <p className="text-[13px] text-center text-muted">
            <strong>Door 1 — Your Key:</strong> free, your endpoint, your key, no balance check.
            <br />
            <strong>Door 2 — The Pool:</strong> community-funded models, 1 cr = 1 token, earn on /earn.
          </p>
        </Card>
      </div>

      <FloatingActionButton
        onAddKey={openAddForm}
        onBulkImport={openBulkImport}
        onConnectAccount={openConnectAccount}
      />
    </div>
  )
}
