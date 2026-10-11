import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, normalizeCatalogModel, type CatalogModel } from '../lib/api'
import { useAuth } from '../lib/auth'
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
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre className="num overflow-x-auto rounded-lg border border-line bg-surface-2 p-3 text-[12px] leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        className="absolute right-2 top-2 rounded-md border border-line bg-bg px-2 py-1 text-[11px] text-muted transition-colors hover:text-content"
        onClick={async () => {
          await navigator.clipboard.writeText(code)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'copied' : `copy${lang ? ` ${lang}` : ''}`}
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
  const [busy, setBusy] = useState(false)

  const loadTokens = useCallback(async () => {
    try {
      const data = await api.get<{ tokens: ApiToken[] }>('/tokens')
      setTokens(data.tokens)
    } catch {
      // Anonymous visitors simply see no token section.
    }
  }, [])

  useEffect(() => {
    if (!authLoading && user) void loadTokens()
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
    setBusy(true)
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
            ? 'Verify your email before creating API tokens.'
            : err instanceof ApiError
              ? err.message
              : 'Could not create a token.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setBusy(true)
    setBanner(null)
    try {
      await api.del<{ ok: boolean }>(`/tokens/${id}`)
      setTokens((prev) => prev.filter((t) => t.id !== id))
    } catch {
      setBanner({ kind: 'err', text: 'Could not revoke that token.' })
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <p className="py-12 text-center text-[13px] text-muted">Loading…</p>

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

      {banner && <p className={`break-all text-[13px] ${banner.kind === 'ok' ? 'text-gain' : 'text-loss'}`}>{banner.text}</p>}

      {/* Step 1 — a key */}
      {user ? (
        <Card>
          <CardHeader title="1 · Create an API key" action={<span className="num text-[12px] text-muted">fl_… · Bearer</span>} />
          <div className="flex flex-col gap-4 p-4">
            <p className="text-[13px] text-muted">
              A key spends from your credit balance. It is shown once and stored hashed — losing it means
              creating a new one. Your email must be verified first.
            </p>
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={createToken}>
              <label className="flex flex-1 flex-col gap-1.5">
                <span className="text-[12px] font-medium uppercase tracking-wide text-muted">Label</span>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="laptop script"
                  maxLength={80}
                  required
                />
              </label>
              <Button type="submit" disabled={busy || label.trim() === ''}>
                {busy ? 'Creating…' : 'Create key'}
              </Button>
            </form>
            {newToken && (
              <div className="flex flex-col gap-2 rounded-lg border border-gain/40 bg-gain/5 p-3">
                <span className="text-[12px] text-gain">
                  Copy this key now — it is stored hashed and never shown again.
                </span>
                <CodeBlock code={newToken} />
              </div>
            )}
            {tokens.length > 0 && (
              <div className="flex flex-col divide-y divide-line">
                {tokens.map((token) => (
                  <div key={token.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="text-[13px]">{token.label}</span>
                    <code className="num text-[12px] text-muted">{token.token_prefix}</code>
                    <span className="num text-[12px] text-muted">
                      last used {token.last_used_at ? new Date(token.last_used_at).toLocaleString() : 'never'}
                    </span>
                    <Button variant="ghost" size="sm" className="ml-auto" disabled={busy} onClick={() => void revoke(token.id)}>
                      Revoke
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
          code={`import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${BASE_URL}',
  apiKey: 'fl_…',   // from step 1, sent as Authorization: Bearer
})

const res = await client.chat.completions.create({
  model: '${models[0]?.slug ?? 'stepfun-5'}',                          // any slug below
  messages: [{ role: 'user', content: 'Hello from curl-safe code' }],
})
console.log(res.choices[0].message.content)

// streamed:
const stream = await client.chat.completions.create({
  model: '${models[0]?.slug ?? 'stepfun-5'}',
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
                <code className="num text-[12px] text-accent">{m.slug}</code>
                <span className="text-[13px] text-muted">{m.label}</span>
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

      <Section title="2 · call it — curl">
        <CodeBlock
          lang="bash"
          code={`# what's in the pool (public)
curl -s ${BASE_URL}/models

# one completion — model is a slug from the list above,
# key goes in the Authorization header as a Bearer token
curl -s ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer fl_…" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${models[0]?.slug ?? 'stepfun-5'}",
    "messages": [{"role": "user", "content": "Explain your metering model."}],
    "temperature": 0.2
  }'

# streamed
curl -N ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer fl_…" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "${models[0]?.slug ?? 'stepfun-5'}",
    "messages": [{"role": "user", "content": "hi"}],
    "stream": true,
    "stream_options": {"include_usage": true}
  }'`}
        />
      </Section>

      {/* Reference */}
      <Section title="3 · endpoints">
        <div className="flex flex-col divide-y divide-line">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2.5">
            <code className="num text-[12px] text-accent">GET /v1/models</code>
            <span className="text-[13px]">Model list, OpenAI shape. No auth.</span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2.5">
            <code className="num text-[12px] text-accent">POST /v1/chat/completions</code>
            <span className="text-[13px]">
              OpenAi request/response. Accepts <code className="num">model</code>, <code className="num">messages</code>,{' '}
              <code className="num">max_tokens</code>, <code className="num">temperature</code>,{' '}
              <code className="num">top_p</code>, <code className="num">stream</code>. Auth: Bearer key or session
              cookie.
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2.5">
            <code className="num text-[12px] text-accent">GET /api/models</code>
            <span className="text-[13px]">
              Richer catalog: status per model, flat rate, context window. No auth.
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 py-2.5">
            <code className="num text-[12px] text-accent">POST /api/chat</code>
            <span className="text-[13px]">
              Native metering endpoint (session cookie only): explicit <code className="num">request_id</code>{' '}
              idempotency, <code className="num">usage</code>/<code className="num">settled</code> SSE events, and
              BYOK mode (<code className="num">key_mode: 'byok'</code> with a vault{' '}
              <code className="num">key_id</code>).
            </span>
          </div>
        </div>
      </Section>

      {/* Billing + errors */}
      <Section title="4 · billing and errors">
        <p className="text-muted">
          Every pool completion is charged in credits equal to the tokens the provider reported. When a
          provider reports no usage, the model's flat rate applies (shown per model in{' '}
          <Link to="/models" className="text-accent hover:underline">/models</Link> and in the{' '}
          <code className="num">freellm.credits_charged</code> field). A failed upstream call costs nothing.
          Insufficient balance → <code className="num">402</code>; locked tier →{' '}
          <code className="num">403 upgrade_required</code> (no charge); failed upstream →{' '}
          <code className="num">502</code>; unknown model → <code className="num">404</code>. Errors follow
          OpenAI's <code className="num">{'{ error: { message, type, code } }'}</code> envelope.
        </p>
      </Section>

      <p className="text-[12px] text-muted">
        The frontend is open source — see the <code className="num">functions/</code> directory for the metering
        and failover implementation.
      </p>
    </div>
  )
}
