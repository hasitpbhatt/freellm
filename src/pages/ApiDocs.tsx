import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, normalizeCatalogModel, type CatalogModel } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { Button, Card, CardHeader, Input } from '../components/ui'

/** Base URL follows the deployment — prod, preview, or local emulator. */
const BASE_URL = typeof window !== 'undefined' ? `${window.location.origin}/v1` : 'https://freellm.hasit.in/v1'

type ApiToken = {
  id: string
  label: string
  token_prefix: string
  last_used_at: number | null
  created_at: number
}

/** Copyable code block — the whole point of this page is that people paste this. */
function CodeBlock({ code, lang, label }: { code: string; lang?: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  return (
    <div className="relative">
      {label && <p className="mb-1 text-[12px] font-medium text-muted">{label}</p>}
      <pre className="num overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 pr-20 text-[12px] leading-relaxed">
        <code className="break-words">{code}</code>
      </pre>
      <button
        className="absolute right-2 top-2 min-h-[40px] min-w-[44px] rounded-md border border-line bg-bg px-2 py-1 text-[11px] text-muted transition-colors hover:text-content"
        aria-label={label ? `Copy ${label}` : 'Copy code'}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            setCopyFailed(false)
            window.setTimeout(() => setCopied(false), 1500)
          } catch {
            setCopyFailed(true)
          }
        }}
      >
        <span aria-live="polite">{copied ? 'copied' : copyFailed ? 'copy failed — select manually' : `copy${lang ? ` ${lang}` : ''}`}</span>
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="flex flex-col gap-3 p-4 text-[13px] leading-relaxed">{children}</div>
    </Card>
  )
}

export default function ApiDocs() {
  const { user, loading: authLoading } = useAuth()
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [models, setModels] = useState<CatalogModel[]>([])
  const [newToken, setNewToken] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const loadTokens = useCallback(async () => {
    try {
      const data = await api.get<{ tokens: ApiToken[] }>('/tokens')
      setTokens(data.tokens)
    } catch {
      // Anonymous visitors simply see no token section.
    }
  }, [])

  useEffect(() => {
    if (!authLoading && user) {
      // oxlint-disable-next-line react/set-state-in-effect -- API token list load once the session resolves
      void loadTokens()
    }
  }, [authLoading, user, loadTokens])

  useEffect(() => {
    api
      .get<{ models: unknown }>('/models')
      .then((data) =>
        setModels(Array.isArray(data?.models) ? data.models.map(normalizeCatalogModel) : []),
      )
      .catch(() => setModels([]))
  }, [])

  async function createToken(event: React.FormEvent) {
    event.preventDefault()
    if (!label.trim()) return
    setBusyAction('create')
    setBanner(null)
    setNewToken(null)
    try {
      const data = await api.post<{ token: string; record: ApiToken }>('/tokens', { label: label.trim() })
      setTokens((prev) => [data.record, ...prev])
      setNewToken(data.token)
      setBanner({ kind: 'ok', text: 'Key created — copy it now, it is stored hashed and never shown again.' })
      setLabel('')
    } catch (err) {
      setBanner({
        kind: 'err',
        text:
          err instanceof ApiError && err.code === 'verification_required'
            ? 'Verify your email on the Earn page before creating API tokens.'
            : err instanceof ApiError
              ? err.message
              : 'Could not create a token.',
      })
    } finally {
      setBusyAction(null)
    }
  }

  async function revoke(id: string, tokenLabel: string) {
    if (!confirm(`Revoke key "${tokenLabel}"? Scripts using it will break immediately. This cannot be undone.`)) return
    setBusyAction(`revoke:${id}`)
    setBanner(null)
    try {
      await api.del<{ ok: boolean }>(`/tokens/${id}`)
      setTokens((prev) => prev.filter((t) => t.id !== id))
      setBanner({ kind: 'ok', text: `Key "${tokenLabel}" revoked.` })
    } catch {
      setBanner({ kind: 'err', text: 'Could not revoke that token.' })
    } finally {
      setBusyAction(null)
    }
  }

  if (authLoading) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

  // Examples below use the first live model; replace with any slug from the list.
  const exampleSlug = models[0]?.slug ?? 'stepfun-5'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Use the Pool from your code</h1>
        <p className="mt-1 text-[13px] text-muted">
          freellm is an OpenAI-compatible gateway to community-funded models. Credits are 1:1 with
          tokens — earn them on <Link to="/earn" className="text-accent hover:underline">/earn</Link> (daily
          check-in, tasks, referrals) and spend them here.
        </p>
      </div>

      {banner && (
        <p role={banner.kind === 'err' ? 'alert' : 'status'} className={`break-all text-[13px] ${banner.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>
          {banner.kind === 'ok' ? '✓ ' : '⚠ '}{banner.text}
        </p>
      )}

      {/* Step 1 — a key */}
      {user ? (
        <Card>
          <CardHeader title="1 · Create an API key" action={<span className="num text-[12px] text-muted">fl_… · Bearer</span>} />
          <div className="flex flex-col gap-4 p-4">
            <p className="text-[13px] text-muted">
              A key spends from your credit balance. It is shown once and stored hashed — losing it means
              creating a new one. {user.email_verified !== 1 ? (
                <>Your email is <strong>not verified yet</strong> — <Link to="/earn" className="text-accent hover:underline">verify it on the Earn page</Link> before creating keys.</>
              ) : (
                <>Your email is verified — you can create keys.</>
              )}
            </p>
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={createToken}>
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-[12px] font-medium uppercase tracking-wide text-muted">Label — shown in the list below so you know which script uses it</span>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="laptop script"
                  maxLength={80}
                  required
                />
              </label>
              <Button type="submit" disabled={busyAction === 'create' || label.trim() === ''}>
                {busyAction === 'create' ? 'Creating…' : 'Create key'}
              </Button>
            </form>
            {newToken && (
              <div className="flex flex-col gap-2 rounded-lg border border-gain/40 bg-gain/5 p-3">
                <span className="text-[12px] text-gain">
                  Copy this key now — it is stored hashed and never shown again. Don't navigate away first.
                </span>
                <CodeBlock code={newToken} label="Your new API key" />
              </div>
            )}
            {tokens.length > 0 && (
              <div className="flex flex-col divide-y divide-line">
                {tokens.map((token) => (
                  <div key={token.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="text-[13px]">{token.label}</span>
                    <code className="num text-[12px] text-muted" title="Key prefix (identifies the key — not usable as a key)">prefix {token.token_prefix}</code>
                    <span className="num text-[12px] text-muted">
                      last used {token.last_used_at ? new Date(token.last_used_at).toLocaleString() : 'never'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      disabled={busyAction !== null}
                      onClick={() => void revoke(token.id, token.label)}
                    >
                      {busyAction === `revoke:${token.id}` ? 'Revoking…' : 'Revoke'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-center">
          <p className="text-[13px] text-muted">
            <Link to="/login" className="text-accent hover:underline">Sign in</Link> to create an API key.
          </p>
        </Card>
      )}

      {/* Step 2 — use it */}
      <Section title="2 · call it — OpenAI SDK">
        <p className="text-muted">
          Any OpenAI-compatible client works. Point it at this deployment's gateway with your{' '}
          <code className="num">fl_…</code> key as the Bearer token:
        </p>
        <CodeBlock
          lang="js"
          label="Install then run (Node 18+)"
          code={`npm install openai
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${BASE_URL}',
  apiKey: 'fl_…',   // from step 1, sent as Authorization: Bearer
})

const res = await client.chat.completions.create({
  model: '${exampleSlug}',                          // any slug below
  messages: [{ role: 'user', content: 'Explain large language models in one sentence.' }],
})
// streamed:
const stream = await client.chat.completions.create({
  model: '${exampleSlug}',
  messages: [{ role: 'user', content: 'stream it' }],
  stream: true,
  stream_options: { include_usage: true },     // get the token counts
})
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? '')`}
        />
      </Section>

      <Section title="Available models — slugs for the model field">
        {models.length === 0 ? (
          <p className="text-muted">Loading the pool catalog…</p>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            {models.map((m) => (
              <div key={m.slug} className="flex flex-wrap items-center gap-2 py-2">
                <code className="num min-w-0 break-all text-[12px] text-accent">{m.slug}</code>
                <button
                  className="btn-secondary btn-sm"
                  aria-label={`Copy slug ${m.slug}`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(m.slug)
                      setBanner({ kind: 'ok', text: `Copied ${m.slug} — paste it as the model field.` })
                    } catch {
                      setBanner({ kind: 'err', text: 'Copy blocked — long-press the slug to select it manually.' })
                    }
                  }}
                >
                  Copy
                </button>
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted" title={m.label}>{m.label}</span>
                {m.access_tier !== 'free' && (
                  <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
                    🔒 {m.access_tier}
                  </span>
                )}
                <span className="num ml-auto text-[12px] text-muted">{m.status}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-muted">
          Locked slugs return <code className="num">403 upgrade_required</code> — no charge is made.
        </p>
      </Section>

      <Section title="3 · call it — curl">
        <CodeBlock
          lang="bash"
          label="List models"
          code={`curl -s ${BASE_URL}/models`}
        />
        <CodeBlock
          lang="bash"
          label="One completion (model = slug above, key = Bearer token)"
          code={`curl -s ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer fl_…" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${exampleSlug}",
    "messages": [{"role": "user", "content": "Explain your metering model."}],
    "temperature": 0.2
  }'`}
        />
        <CodeBlock
          lang="bash"
          label="Streamed"
          code={`curl -N ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer fl_…" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${exampleSlug}",
    "messages": [{"role": "user", "content": "hi"}],
    "stream": true,
    "stream_options": {"include_usage": true}
  }'}`}
        />
        <CodeBlock
          lang="bash"
          label="Through your own key (BYOK — free, uses your vault credential)"
          code={`# Bind an API token to a connection once —
#   POST /api/tokens  {"label": "laptop", "connection_id": "YOUR_CONNECTION_ID"}
# — then every call is plain OpenAI. No extra fields: model is passed
# straight to your endpoint.
curl -s ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer fl_…" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${exampleSlug}",
    "messages": [{"role": "user", "content": "hi"}]
  }'

# One-off, without binding a token: name the connection explicitly.
curl -s ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer fl_…" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${exampleSlug}",
    "messages": [{"role": "user", "content": "hi"}],
    "connection_id": "YOUR_CONNECTION_ID"
  }'`}
        />
      </Section>

      {/* Reference */}
      <Section title="4 · endpoints">
        <p className="text-muted">
          Gateway base URL is <code className="num">{BASE_URL}</code> for the <code className="num">/v1/*</code>{' '}
          OpenAI-compatible surface. The <code className="num">/api/*</code> native surface lives at the same
          origin root (e.g. <code className="num">{typeof window !== 'undefined' ? window.location.origin : ''}/api/…</code>).
        </p>
        <div className="flex flex-col divide-y divide-line">
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2.5">
            <code className="num text-[12px] text-accent">GET /v1/models</code>
            <span className="text-[13px]">Model list, OpenAI shape. No auth.</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2.5">
            <code className="num text-[12px] text-accent">POST /v1/chat/completions</code>
            <span className="text-[13px]">
              OpenAI request/response. Accepts <code className="num">model</code>, <code className="num">messages</code>,{' '}
              <code className="num">max_tokens</code>, <code className="num">temperature</code>,{' '}
              <code className="num">top_p</code>, <code className="num">stream</code>,{' '}
              <code className="num">stream_options.include_usage</code>. Auth: Bearer key or session
              cookie. By default it draws from The Pool. To dial your own credential (API key or OAuth
              account) instead — free, unmetered, per-user only — bind an API token to a connection
              when you create it, or pass <code className="num">connection_id</code>. No other fields
              change; <code className="num">model</code> goes straight to your endpoint.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2.5">
            <code className="num text-[12px] text-accent">GET /api/models</code>
            <span className="text-[13px]">
              Richer catalog: status per model, flat rate, context window. No auth.
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2.5">
            <code className="num text-[12px] text-accent">POST /api/chat</code>
            <span className="text-[13px]">
              Native metering endpoint (session cookie only): explicit <code className="num">request_id</code>{' '}
              idempotency, <code className="num">usage</code>/<code className="num">settled</code> SSE events, and
              BYOK via <code className="num">connection_id</code> (a vault credential).
            </span>
          </div>
        </div>
      </Section>

      {/* Billing + errors */}
      <Section title="5 · billing and errors">
        <p className="text-muted">
          Every pool completion is charged in credits equal to the tokens the provider reported. When a
          provider reports no usage, the model's flat rate applies (shown per model in{' '}
          <Link to="/models" className="text-accent hover:underline">/models</Link> and in the{' '}
          <code className="num">freellm.credits_charged</code> field of the completion response). A failed
          upstream call costs nothing.
        </p>
        <div className="flex flex-col divide-y divide-line">
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2">
            <code className="num text-[12px] text-accent">402 insufficient_credits</code>
            <span className="text-[13px]">Top up on <Link to="/earn" className="text-accent hover:underline">/earn</Link>.</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2">
            <code className="num text-[12px] text-accent">403 upgrade_required</code>
            <span className="text-[13px]">Locked tier — no charge. Ask an admin for access.</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2">
            <code className="num text-[12px] text-accent">502 upstream_failed</code>
            <span className="text-[13px]">Provider error — no charge. Retry shortly.</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2">
            <code className="num text-[12px] text-accent">404 model_not_found</code>
            <span className="text-[13px]">Unknown slug — pick one from the list in step 2.</span>
          </div>
        </div>
        <p className="text-muted">
          Errors follow OpenAI's <code className="num">{'{ error: { message, type, code } }'}</code> envelope.
        </p>
      </Section>

      <p className="text-[12px] text-muted">
        The frontend is open source — see the <code className="num">functions/</code> directory for the metering
        and failover implementation.
      </p>
    </div>
  )
}
