// OAuth provider registry for freellm's BYOK vault.
//
// Wiring matches 9router's MIT-licensed registry (decolua/9router,
// open-sse/providers/registry/* + src/lib/oauth/*), adapted to a server-side
// flow: the browser authorizes, our callback exchanges the code, and the
// vault row is created pre-filled (endpoint, model, protocol) so the user
// never types endpoint details.
//
// Single-file module on purpose: this used to be an oauth.js + oauth.d.ts
// pair, and the Pages Functions bundler tried to compile the .d.ts as a real
// module ("The constant OAUTH_PROVIDERS must be initialized"), breaking every
// deploy. Never split a functions/ module into .js + .d.ts again.

import type { Bindings } from './types'

export type OAuthFlowType = 'authorization_code' | 'device_code'

/** Device-flow wire shape. 'rfc' = RFC 8628 (grok); kilo/qoder are custom. */
export type OAuthDeviceStyle = 'rfc' | 'kilo' | 'qoder'

export interface OAuthVaultFill {
  /** Vault base_url. For codex this is the full Responses endpoint. */
  baseUrl: string
  upstreamModel: string
  protocol: 'openai' | 'codex'
  label: string
}

export interface OAuthProviderConfig {
  id: string
  name: string
  flowType: OAuthFlowType
  /** PKCE authorization endpoint (authorization_code only). */
  authorizeUrl?: string
  /** Token endpoint (authorization_code exchange, rfc device poll, refresh). */
  tokenUrl: string
  /** Optional bundled fallback. Prefer the clientIdEnv override below. */
  clientId?: string
  /**
   * Env var(s) holding the client id, checked in order before the bundled
   * fallback. A list lets a provider prefer a dedicated vault client and
   * still work off a shared one — google falls back to the sign-in client.
   */
  clientIdEnv?: keyof Bindings | ReadonlyArray<keyof Bindings>
  /** Sent as client_secret on code exchange / refresh when present. */
  clientSecret?: string
  /**
   * Env var(s) holding the client secret, checked in order before the bundled
   * fallback. Keeps credentials rotatable without a code change — and out of
   * git.
   */
  clientSecretEnv?: keyof Bindings | ReadonlyArray<keyof Bindings>
  scope: string
  /** Extra authorize-query params (codex simplified flow). */
  extraParams?: Record<string, string>
  // -- device_code --
  deviceStyle?: OAuthDeviceStyle
  /** RFC 8628 device-authorization endpoint (grok). */
  deviceCodeUrl?: string
  /** Kilo: POST JSON (empty body) here -> { code, verificationUrl, expiresIn }. */
  initiateUrl?: string
  /** Kilo: GET {pollUrlBase}/{code} -> 202 pending / 403 denied / 410 expired. */
  pollUrlBase?: string
  /** Kilo: Bearer profile lookup for the org id (stored as account_id). */
  profileUrl?: string
  /** Qoder: browser landing page (challenge/nonce/machine_id in query). */
  loginUrl?: string
  /** Qoder: GET {deviceTokenUrl}?nonce=&verifier=&challenge_method=S256. */
  deviceTokenUrl?: string
  /** Qoder: GET Bearer userinfo for display name/email. */
  userInfoUrl?: string
  /**
   * False when the upstream has no usable refresh (qoder device tokens:
   * refresh returns 403; kilo issues no refresh token). The vault then stores
   * no refresh token and /keys/:id/refresh refuses with "reconnect instead".
   */
  refreshable: boolean
  /**
   * False while no chat adapter can dial the filled endpoint (antigravity's
   * custom format, grok's Responses API, qoder's signed endpoint). Connect
   * still stores the credential correctly; the Keys UI says chat is pending.
   */
  chatReady: boolean
  /** Row defaults written by the callback on success. */
  vaultFill: OAuthVaultFill
}

/** Placeholder client ids mean "not wired up" — no Connect button. */
const PLACEHOLDER_CLIENT_ID = 'your-client-id-here'

/**
 * First non-empty value among the configured env names, in order. Accepts a
 * single name or a preference list (google: dedicated vault client first,
 * then the shared sign-in client).
 */
function firstEnvValue(
  env: Bindings,
  names: keyof Bindings | ReadonlyArray<keyof Bindings> | undefined,
): string | undefined {
  if (!names) return undefined
  const candidates: ReadonlyArray<keyof Bindings> = typeof names === 'string' ? [names] : names
  for (const name of candidates) {
    const value = env[name]
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

/**
 * The client id to use: env override(s) first, bundled fallback second.
 * Returns undefined when none is set (or the fallback is the
 * placeholder), which callers treat as "provider not configured".
 */
export function providerClientId(env: Bindings, config: OAuthProviderConfig): string | undefined {
  const fromEnv = firstEnvValue(env, config.clientIdEnv)
  if (fromEnv) return fromEnv
  if (config.clientId && config.clientId !== PLACEHOLDER_CLIENT_ID) return config.clientId
  return undefined
}

export function isConfigured(env: Bindings, config: OAuthProviderConfig): boolean {
  return providerClientId(env, config) !== undefined
}

// ---------------------------------------------------------------- registry
// URLs + client ids from 9router (codex.js, gemini-cli.js, antigravity.js +
// shared.js, grok-cli.js, kilocode.js + src/lib/oauth/providers/kilocode.js,
// qoder.js + src/lib/oauth/{providers/qoder,services/qoder}.js + shared/qoder).

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  codex: {
    id: 'codex',
    name: 'Codex (ChatGPT)',
    flowType: 'authorization_code',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    scope: 'openid profile email offline_access',
    extraParams: {
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'codex_cli_rs',
    },
    refreshable: true,
    chatReady: true,
    vaultFill: {
      baseUrl: 'https://chatgpt.com/backend-api/codex/responses',
      upstreamModel: 'gpt-5.5',
      protocol: 'codex',
      label: 'Codex (ChatGPT)',
    },
  },

  google: {
    id: 'google',
    name: 'Google / Gemini',
    flowType: 'authorization_code',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // Credentials live in env so they never ship in git and can be rotated
    // without a redeploy. The dedicated vault names win; when they are unset
    // the flow reuses the Google sign-in client (GOOGLE_CLIENT_ID /
    // GOOGLE_CLIENT_SECRET), which is the only Google client most installs
    // have. Set secrets via `wrangler pages secret put` or .dev.vars locally;
    // see the README's BYOK section. Either way the client must whitelist the
    // vault callback (/api/oauth/callback/google) and the consent screen must
    // allow the generative-language scope.
    clientIdEnv: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_CLIENT_ID'],
    clientSecretEnv: ['GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET'],
    scope: 'openid email profile https://www.googleapis.com/auth/generative-language',
    refreshable: true,
    chatReady: true,
    vaultFill: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      upstreamModel: 'gemini-2.5-flash',
      protocol: 'openai',
      label: 'Google / Gemini',
    },
  },

  antigravity: {
    id: 'antigravity',
    name: 'Antigravity',
    flowType: 'authorization_code',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // Credentials live in env (ANTIGRAVITY_OAUTH_CLIENT_ID /
    // ANTIGRAVITY_OAUTH_CLIENT_SECRET) — same rationale as google above.
    clientIdEnv: 'ANTIGRAVITY_OAUTH_CLIENT_ID',
    clientSecretEnv: 'ANTIGRAVITY_OAUTH_CLIENT_SECRET',
    scope: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/cclog',
      'https://www.googleapis.com/auth/experimentsandconfigs',
    ].join(' '),
    refreshable: true,
    chatReady: false,
    vaultFill: {
      // NOTE: the IDE endpoint speaks a custom v1internal format our generic
      // OpenAI dialer cannot drive yet — the row captures the credential
      // correctly (Google OAuth token, never revealable); chat needs a future
      // antigravity adapter. Repoint base_url at the Gemini OpenAI endpoint
      // to chat with this token today.
      baseUrl: 'https://daily-cloudcode-pa.googleapis.com',
      upstreamModel: 'gemini-3.8-flash',
      protocol: 'openai',
      label: 'Antigravity',
    },
  },

  grok: {
    id: 'grok',
    name: 'Grok Build (xAI)',
    flowType: 'device_code',
    deviceStyle: 'rfc',
    deviceCodeUrl: 'https://auth.x.ai/oauth2/device/code',
    tokenUrl: 'https://auth.x.ai/oauth2/token',
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    scope: 'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write',
    refreshable: true,
    chatReady: false,
    vaultFill: {
      // NOTE: cli-chat-proxy speaks the Responses API with xAI-specific auth;
      // our codex adapter targets the ChatGPT backend only. Row captures the
      // credential; chat needs a future grok adapter.
      baseUrl: 'https://cli-chat-proxy.grok.com/v1/responses',
      upstreamModel: 'grok-build',
      protocol: 'openai',
      label: 'Grok Build (xAI)',
    },
  },

  kilo: {
    id: 'kilo',
    name: 'Kilo Code',
    flowType: 'device_code',
    deviceStyle: 'kilo',
    tokenUrl: 'https://api.kilo.ai/api/device-auth/codes',
    initiateUrl: 'https://api.kilo.ai/api/device-auth/codes',
    pollUrlBase: 'https://api.kilo.ai/api/device-auth/codes',
    profileUrl: 'https://api.kilo.ai/api/profile',
    clientId: 'kilo-code',
    scope: '',
    refreshable: false,
    chatReady: true,
    vaultFill: {
      baseUrl: 'https://api.kilo.ai/api/openrouter',
      upstreamModel: 'google/gemini-2.5-flash',
      protocol: 'openai',
      label: 'Kilo Code',
    },
  },

  qoder: {
    id: 'qoder',
    name: 'Qoder',
    flowType: 'device_code',
    deviceStyle: 'qoder',
    tokenUrl: 'https://center.qoder.sh/algo/api/v3/user/refresh_token',
    loginUrl: 'https://qoder.com/device/selectAccounts',
    deviceTokenUrl: 'https://openapi.qoder.sh/api/v1/deviceToken/poll',
    userInfoUrl: 'https://openapi.qoder.sh/api/v1/userinfo',
    clientId: 'qoder-device',
    scope: '',
    refreshable: false,
    chatReady: false,
    vaultFill: {
      // NOTE: inference is a COSY-signed custom SSE endpoint our generic
      // dialer cannot drive yet. Row captures the dt-... credential correctly;
      // chat needs a future qoder adapter.
      baseUrl: 'https://api3.qoder.sh',
      upstreamModel: 'auto',
      protocol: 'openai',
      label: 'Qoder',
    },
  },
}

// Helper to get provider config
export function getOAuthProviderConfig(providerId: string): OAuthProviderConfig | undefined {
  return OAUTH_PROVIDERS[providerId]
}

// Helper to check if provider supports OAuth
export function isOAuthProvider(providerId: string): boolean {
  return !!OAUTH_PROVIDERS[providerId]
}

/**
 * The client secret to send for a provider: env override(s) first (rotation
 * without redeploy), bundled registry value as fallback.
 */
export function providerClientSecret(env: Bindings, config: OAuthProviderConfig): string | undefined {
  const fromEnv = firstEnvValue(env, config.clientSecretEnv)
  if (fromEnv) return fromEnv
  return config.clientSecret
}

/**
 * Identity claimed by a provider's id_token (JWT). The payload is read, not
 * signature-checked: the token came back over TLS from the provider's own
 * token endpoint in the exchange that just succeeded, and it is no less
 * trusted than the access_token we store from that same response. It only
 * names the account for the label and for de-duplication — it authorizes
 * nothing. `sub` is the stable account id (emails change); `email` is
 * display-only. Returns null on anything unexpected, in which case the caller
 * keeps the one-account-per-provider behaviour.
 */
export function accountFromIdToken(idToken: string): { id: string; email: string | null } | null {
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    // base64url -> base64 (+ padding: some runtimes reject an unpadded body).
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { sub?: unknown; email?: unknown }
    if (typeof claims.sub !== 'string' || !claims.sub) return null
    const email = typeof claims.email === 'string' && claims.email ? claims.email : null
    return { id: claims.sub, email }
  } catch {
    return null
  }
}

/**
 * Extra BYOK dial headers for providers that bind an account per request.
 * Kilo Code routes by organization (X-Kilocode-OrganizationID, captured at
 * connect time into account_id); every other protocol needs none.
 */
export function byokExtraHeaders(baseUrl: string, accountId: string | null | undefined): Record<string, string> {
  if (accountId && baseUrl.toLowerCase().includes('kilo.ai')) {
    return { 'X-Kilocode-OrganizationID': accountId }
  }
  return {}
}

/**
 * Matches a vault row back to its OAuth provider: exact registry base_url
 * first (callback-filled rows), then the legacy host/label sniffing for
 * manually added rows.
 */
export function providerIdForVaultRow(baseUrl: string, label: string): string | null {
  const base = baseUrl.toLowerCase()
  const name = label.toLowerCase()
  for (const [id, config] of Object.entries(OAUTH_PROVIDERS)) {
    if (base === config.vaultFill.baseUrl.toLowerCase()) return id
  }
  if (base.includes('chatgpt.com') || name.includes('codex')) return 'codex'
  if (base.includes('kilo.ai')) return 'kilo'
  if (base.includes('qoder') || name.includes('qoder')) return 'qoder'
  if (base.includes('googleapis.com') || name.includes('gemini') || name.includes('google')) return 'google'
  if (base.includes('cloudcode-pa') || base.includes('antigravity') || base.includes('meta.com') || name.includes('antigravity')) {
    return 'antigravity'
  }
  if (base.includes('x.ai') || name.includes('grok')) return 'grok'
  return null
}

// Providers that support OAuth, filtered to those with a resolvable client
// id for this deployment (env override or bundled fallback). Call with the
// request env so a deployment that has not configured Google simply does not
// offer the button, instead of failing mid-flow.
export function oauthProviderList(env: Bindings): Array<{ id: string; name: string; chatReady: boolean }> {
  return Object.values(OAUTH_PROVIDERS)
    .filter((config) => isConfigured(env, config))
    .map(({ id, name, chatReady }) => ({ id, name, chatReady }))
}
