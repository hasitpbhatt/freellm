import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Bindings } from '../functions/lib/types'
import {
  OAUTH_PROVIDERS,
  accountFromIdToken,
  oauthProviderList,
  providerClientId,
  byokExtraHeaders,
  getOAuthProviderConfig,
  isConfigured,
  isOAuthProvider,
  providerClientSecret,
  providerIdForVaultRow,
} from '../functions/lib/oauth'

test('oauth registry: every provider has the URLs its flow needs', () => {
  for (const [id, config] of Object.entries(OAUTH_PROVIDERS)) {
    assert.equal(config.id, id, 'registry key matches config.id')
    assert.ok(config.name, `${id} needs a display name`)
    assert.ok(config.tokenUrl.startsWith('https://'), `${id} needs an https tokenUrl`)
    assert.ok(config.refreshable !== undefined, `${id} must declare refreshable`)
    if (!config.clientIdEnv) {
      assert.ok(config.clientId, `${id} needs a clientId or clientIdEnv`)
    }
    if (config.flowType === 'authorization_code') {
      assert.ok(config.authorizeUrl?.startsWith('https://'), `${id} needs an authorizeUrl`)
      assert.ok(config.scope, `${id} needs a scope`)
    } else {
      assert.ok(config.deviceStyle, `${id} needs a deviceStyle`)
      if (config.deviceStyle === 'rfc') {
        assert.ok(config.deviceCodeUrl?.startsWith('https://'), `${id} needs a deviceCodeUrl`)
      } else if (config.deviceStyle === 'kilo') {
        assert.ok(config.initiateUrl?.startsWith('https://'), `${id} needs an initiateUrl`)
        assert.ok(config.pollUrlBase?.startsWith('https://'), `${id} needs a pollUrlBase`)
        assert.ok(config.profileUrl?.startsWith('https://'), `${id} needs a profileUrl`)
      } else {
        assert.ok(config.loginUrl?.startsWith('https://'), `${id} needs a loginUrl`)
        assert.ok(config.deviceTokenUrl?.startsWith('https://'), `${id} needs a deviceTokenUrl`)
        assert.ok(config.userInfoUrl?.startsWith('https://'), `${id} needs a userInfoUrl`)
      }
    }
  }
})

test('oauth registry: vault fills are valid rows', () => {
  for (const [id, config] of Object.entries(OAUTH_PROVIDERS)) {
    const fill = config.vaultFill
    assert.ok(fill.baseUrl.startsWith('https://'), `${id} fill needs an https baseUrl`)
    assert.ok(fill.upstreamModel.trim(), `${id} fill needs an upstreamModel`)
    assert.ok(fill.protocol === 'openai' || fill.protocol === 'codex', `${id} fill needs a valid protocol`)
    assert.ok(fill.label.trim(), `${id} fill needs a label`)
  }
})

test('oauth registry: no placeholders in the shipped config', () => {
  for (const [id, config] of Object.entries(OAUTH_PROVIDERS)) {
    for (const url of [
      config.authorizeUrl,
      config.tokenUrl,
      config.deviceCodeUrl,
      config.initiateUrl,
      config.pollUrlBase,
      config.profileUrl,
      config.loginUrl,
      config.deviceTokenUrl,
      config.userInfoUrl,
      config.vaultFill.baseUrl,
    ]) {
      if (url != null) assert.ok(!url.includes('your-'), `${id} ships a placeholder URL: ${url}`)
    }
    if (config.clientId) {
      assert.ok(!config.clientId.includes('your-'), `${id} ships a placeholder clientId`)
    }
    const cid = providerClientId({} as unknown as Bindings, config)
    if (config.clientId && config.clientId !== 'your-client-id-here') {
      assert.ok(cid && !cid.includes('your-'), `${id} ships a resolvable clientId`)
    } else if (!config.clientIdEnv) {
      assert.ok(cid, `${id} should be resolvable without env`)
    }
    // if only env-based, no shipped clientId is expected - that's fine
  }
  assert.ok(Object.keys(OAUTH_PROVIDERS).length >= 6, 'all six providers are wired up')
})

test('oauth registry: chat-ready flags match the dialable set', () => {
  const ready = Object.entries(OAUTH_PROVIDERS)
    .filter(([, config]) => config.chatReady)
    .map(([id]) => id)
    .sort()
  assert.deepEqual(ready, ['codex', 'google', 'kilo'])
  for (const entry of oauthProviderList({} as unknown as Bindings)) {
    assert.equal(entry.chatReady, getOAuthProviderConfig(entry.id)?.chatReady)
  }
})

test('providerClientSecret: env override wins, registry is the fallback', () => {
  const google = getOAuthProviderConfig('google')!
  const env = { GOOGLE_OAUTH_CLIENT_SECRET: 'rotated-secret' } as unknown as Bindings
  assert.equal(providerClientSecret(env, google), 'rotated-secret')
  assert.equal(providerClientSecret({} as unknown as Bindings, google), google.clientSecret)
  const codex = getOAuthProviderConfig('codex')!
  assert.equal(providerClientSecret(env, codex), undefined)
})

test('oauth registry: codex matches the public CLI flow', () => {
  const codex = getOAuthProviderConfig('codex')!
  assert.equal(codex.clientId, 'app_EMoamEEZ73f0CkXaXp7hrann')
  assert.equal(codex.authorizeUrl, 'https://auth.openai.com/oauth/authorize')
  assert.equal(codex.extraParams?.originator, 'codex_cli_rs')
  assert.equal(codex.vaultFill.protocol, 'codex')
})

test('oauth helpers: lookups and row matching', () => {
  assert.equal(isOAuthProvider('kilo'), true)
  assert.equal(isOAuthProvider('nope'), false)
  assert.equal(getOAuthProviderConfig('nope'), undefined)
  assert.equal(isConfigured({} as unknown as Bindings, getOAuthProviderConfig('codex')!), true)
  // Exact registry base_url wins.
  assert.equal(providerIdForVaultRow('https://api.kilo.ai/api/openrouter', 'Kilo Code (Auto)'), 'kilo')
  assert.equal(providerIdForVaultRow('https://chatgpt.com/backend-api/codex/responses', 'x'), 'codex')
  // Legacy sniffing still works for hand-added rows.
  assert.equal(providerIdForVaultRow('https://generativelanguage.googleapis.com/v1beta/openai', 'Gemini'), 'google')
  assert.equal(providerIdForVaultRow('https://daily-cloudcode-pa.googleapis.com', 'x'), 'antigravity')
  assert.equal(providerIdForVaultRow('https://example.com/v1', 'Mine'), null)
})

test('byokExtraHeaders: kilo org binding only', () => {
  assert.deepEqual(byokExtraHeaders('https://api.kilo.ai/api/openrouter', 'org-1'), {
    'X-Kilocode-OrganizationID': 'org-1',
  })
  assert.deepEqual(byokExtraHeaders('https://api.kilo.ai/api/openrouter', null), {})
  assert.deepEqual(byokExtraHeaders('https://api.openai.com/v1', 'org-1'), {})
})

test('providerClientId: google prefers a dedicated vault client, falls back to the sign-in client', () => {
  const google = getOAuthProviderConfig('google')!
  // Production shape: only the sign-in names are set — the vault must still work,
  // or Google shows up as "not configured" with no way to connect.
  const signInOnly = { GOOGLE_CLIENT_ID: 'sign-in-client' } as unknown as Bindings
  assert.equal(providerClientId(signInOnly, google), 'sign-in-client')
  assert.equal(isConfigured(signInOnly, google), true)
  // An explicitly configured vault client wins over the shared one.
  const both = { GOOGLE_OAUTH_CLIENT_ID: 'vault-client', GOOGLE_CLIENT_ID: 'sign-in-client' } as unknown as Bindings
  assert.equal(providerClientId(both, google), 'vault-client')
  // An empty string never shadows the next name in the preference list.
  const emptyFirst = { GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_CLIENT_ID: 'sign-in-client' } as unknown as Bindings
  assert.equal(providerClientId(emptyFirst, google), 'sign-in-client')
  assert.equal(providerClientId({} as unknown as Bindings, google), undefined)
  // The secret follows the same order.
  assert.equal(providerClientSecret({ GOOGLE_CLIENT_SECRET: 'sign-in-secret' } as unknown as Bindings, google), 'sign-in-secret')
  const secrets = { GOOGLE_OAUTH_CLIENT_SECRET: 'vault-secret', GOOGLE_CLIENT_SECRET: 'sign-in-secret' } as unknown as Bindings
  assert.equal(providerClientSecret(secrets, google), 'vault-secret')
  // Other providers keep a single env name plus their bundled fallback.
  const codex = getOAuthProviderConfig('codex')!
  assert.equal(providerClientId({} as unknown as Bindings, codex), codex.clientId)
  assert.equal(providerClientId({ GOOGLE_CLIENT_ID: 'sign-in-client' } as unknown as Bindings, codex), codex.clientId)
})

/** base64url id_token body, unpadded like the real thing. */
function idTokenBody(claims: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(claims))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

test('accountFromIdToken: names the account so two accounts for one provider can coexist', () => {
  const body = idTokenBody({ sub: '104900000000000000001', email: 'hasit@example.com', name: 'Hasit' })
  assert.deepEqual(accountFromIdToken(`header.${body}.sig`), { id: '104900000000000000001', email: 'hasit@example.com' })
  // Emails are shown in the vault label, so UTF-8 has to survive the round trip.
  const unicode = idTokenBody({ sub: 'u-2', email: 'zoë@example.com' })
  assert.deepEqual(accountFromIdToken(`header.${unicode}.sig`), { id: 'u-2', email: 'zoë@example.com' })
  // No sub → no identity: the callback falls back to one-account-per-provider.
  assert.equal(accountFromIdToken(`header.${idTokenBody({ email: 'x@y.z' })}.sig`), null)
  // A sub alone still identifies the account.
  assert.deepEqual(accountFromIdToken(`header.${idTokenBody({ sub: 'abc' })}.sig`), { id: 'abc', email: null })
  // Garbage is never fatal — a provider answering oddly must not break the connect.
  assert.equal(accountFromIdToken('not-a-jwt'), null)
  assert.equal(accountFromIdToken(`header.${'!'.repeat(12)}.sig`), null)
  assert.equal(accountFromIdToken('header.@@@.sig'), null)
  assert.equal(accountFromIdToken(''), null)
})
