import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'
import { api, ApiError } from '../../lib/api'
import { haptic } from '../../lib/useHaptics'

interface OAuthProvider {
  id: string
  name: string
  flowType: string
  chatReady: boolean
}

interface DeviceInfo {
  providerId: string
  providerName: string
  userCode: string
  verificationUri: string
}

interface OAuthProvidersProps {
  onConnect: (providerId: string, providerName: string) => void
  isAdding: boolean
  pollingProviders: Record<string, { state: string; interval: number } | null>
  deviceInfo: DeviceInfo | null
  onCancelDevice: (providerId: string) => void
}

/** Formats a code like ABCD-EFGH for legibility; no-ops on odd input. */
function formatCode(code: string): string {
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (clean.length !== 8) return code.toUpperCase()
  return `${clean.slice(0, 4)}-${clean.slice(4)}`
}

export function OAuthProviders({
  onConnect,
  isAdding,
  pollingProviders,
  deviceInfo,
  onCancelDevice,
}: OAuthProvidersProps) {
  const [providers, setProviders] = useState<OAuthProvider[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Load the wired-up provider list once on mount. The parent's keys load and
  // this run independently — a failure here only disables Connect, never the
  // whole page.
  useEffect(() => {
    void loadProviders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadProviders = async () => {
    try {
      setError(null)
      const data = await api.get<{ providers: OAuthProvider[] }>('/oauth/providers')
      setProviders(data.providers)
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : err instanceof Response ? await err.text() : String(err)
      setError(`Failed to load providers: ${msg}. Need help? Contact help@freellm.hasit.in`)
    } finally {
      setLoaded(true)
    }
  }

  const copyCode = async (code: string) => {
    haptic()
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can be unavailable (insecure context, denied permission).
      // The code stays selectable in the DOM, so nothing is lost.
      setCopied(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted">
        One click per account — endpoint, model, and tokens fill in automatically. Add more for multi-account use.
      </p>
      {!loaded ? (
        <p className="text-[13px] text-muted">Loading providers…</p>
      ) : providers.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[13px] text-muted mb-2">
            Account connect is unavailable right now
          </p>
          <button
            type="button"
            className="text-accent hover:underline min-h-[44px] px-3 py-2"
            onClick={loadProviders}
          >
            Retry
          </button>
          <p className="mt-2 text-[13px] text-muted">or add an API key manually below.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="OAuth providers">
            {providers.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => { haptic(); onConnect(p.id, p.name) }}
                disabled={isAdding || pollingProviders[p.id] != null}
                title={p.chatReady ? `Connect ${p.name}` : `Connect ${p.name} — stores the credential; chat support is still pending`}
                className="min-h-[44px] min-w-[44px]"
              >
                {pollingProviders[p.id] != null ? (
                  <>
                    <span className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden="true" />
                    Waiting on {p.name}…
                  </>
                ) : (
                  `Connect ${p.name}`
                )}
              </Button>
            ))}
          </div>
          {providers.some((p) => !p.chatReady) && (
            <p className="text-[12px] text-muted" role="status">
              {providers.filter((p) => !p.chatReady).map((p) => p.name).join(', ')}: connect stores the
              credential, but chat support is still pending — reconnect later, nothing to fix on your end.
            </p>
          )}
          {error && (
            <div className="rounded-lg border border-loss/40 bg-loss/10 p-3 text-[13px] text-loss" role="alert">
              {error}
            </div>
          )}
        </>
      )}
      {deviceInfo && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-4 space-y-3 animate-slide-down" role="dialog" aria-label="Device authorization">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium">Step 1 — enter this code at {deviceInfo.providerName}</p>
            <span className="num rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent">1 / 2</span>
          </div>
          {/* Large, grouped, selectable and copyable — readable across a room and
              friendly to one-handed use. */}
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <p className="num w-full select-all rounded-lg bg-surface py-4 text-center font-mono text-4xl font-bold tracking-[0.2em] sm:w-auto sm:px-6">
              {formatCode(deviceInfo.userCode)}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void copyCode(deviceInfo.userCode)}
              className="min-h-[44px] min-w-[44px]"
            >
              {copied ? '✓ Copied' : 'Copy code'}
            </Button>
          </div>
          <div>
            <p className="text-[13px] font-medium">Step 2 — approve on the opened page</p>
            <p className="text-[12px] text-muted">
              The verification page opened in a new tab. Approve there and the key appears below automatically —
              keep this page open.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <a
              href={deviceInfo.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] text-accent hover:underline min-h-[44px] flex items-center justify-center rounded-lg border border-accent/40 px-4"
            >
              Open verification page again →
            </a>
            <button
              type="button"
              onClick={() => { haptic(); onCancelDevice(deviceInfo.providerId) }}
              className="text-[12px] text-muted hover:text-content min-h-[44px] px-3"
            >
              Cancel
            </button>
          </div>
          {/* Polling status — the loop keeps running server-side, so say so. */}
          <p className="flex items-center gap-2 text-[12px] text-muted" role="status">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
            Waiting for approval — checks every {pollingProviders[deviceInfo.providerId]?.interval ?? 5}s, up to 10 minutes.
          </p>
        </div>
      )}
    </div>
  )
}
