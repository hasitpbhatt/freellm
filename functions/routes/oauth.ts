// OAuth routes for freellm - handles PKCE/device flows and token management

import { Hono } from 'hono'
import { requireAuth } from '../lib/middleware'
import { getOAuthProviderConfig, isOAuthProvider } from '../lib/oauth'
import { decryptSecret, encryptSecret, newId } from '../lib/crypto'
import type { Bindings, Variables, ApiKeyRow } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// PKCE helpers
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function requireEncryptionKey(env: Bindings): string | null {
  return env.ENCRYPTION_KEY || null
}

// Store PKCE state temporarily (in production, use KV with TTL)
type PkceData = { verifier: string; provider: string; userId: string; state: string }
type DeviceCodeData = { deviceCode: string; userCode: string; interval: number; expiresAt: number; provider: string; userId: string; state: string }
const pkceStore = new Map<string, PkceData | DeviceCodeData>()

// =====================================================================
// Start OAuth flow
// =====================================================================
app.use('/api/oauth/*', requireAuth)

app.get('/api/oauth/start/:provider', async (c) => {
  const user = c.get('user')
  const providerId = c.req.param('provider')
  
  if (!isOAuthProvider(providerId)) {
    return c.json({ error: 'invalid_provider', message: 'Unknown OAuth provider.' }, 400)
  }
  
  const config = getOAuthProviderConfig(providerId)
  if (!config) {
    return c.json({ error: 'not_configured', message: 'Provider not configured.' }, 500)
  }
  
  const state = crypto.randomUUID()
  let authUrl: string
  
  if (config.flowType === 'device_code') {
    // Device code flow (Qoder, Grok)
    if (!config.deviceCodeUrl) {
      return c.json({ error: 'not_configured', message: 'Device code URL not configured' }, 500)
    }
    try {
      const response = await fetch(config.deviceCodeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          scope: config.scope
        })
      })
      
      if (!response.ok) {
        const error = await response.text()
        return c.json({ error: 'device_code_failed', message: `Device code request failed: ${error}` }, 502)
      }
      
interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval: number
  error?: string
}
    const data = await response.json() as DeviceCodeResponse
      authUrl = data.verification_uri_complete || `${data.verification_uri}?user_code=${data.user_code}`
      
      // Store device code for polling
      pkceStore.set(`device:${state}`, {
        deviceCode: data.device_code,
        userCode: data.user_code,
        interval: data.interval || 5,
        expiresAt: Date.now() + (data.expires_in || 900) * 1000,
        provider: providerId,
        userId: user.id,
        state
      })
      
      return c.json({
        authUrl,
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri,
        interval: data.interval || 5,
        expiresIn: data.expires_in || 900,
        state
      })
    } catch (err) {
      return c.json({ error: 'device_code_failed', message: err instanceof Error ? err.message : 'Unknown error' }, 502)
    }
  } else {
    // Authorization Code Flow with PKCE (Codex, Google, Antigravity)
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    })
    
    authUrl = `${config.authorizeUrl}?${params.toString()}`
    
    // Store PKCE verifier
    pkceStore.set(state, { verifier, provider: providerId, userId: user.id, state })
    
    // Clean up after 10 minutes
    setTimeout(() => pkceStore.delete(state), 10 * 60 * 1000)
    
    return c.json({ authUrl, state })
  }
})

// =====================================================================
// OAuth callback handler
// =====================================================================
app.get('/api/oauth/callback/:provider', async (c) => {
  const providerId = c.req.param('provider')
  
  if (!isOAuthProvider(providerId)) {
    return c.html(`<h1>Unknown provider</h1>`, 400)
  }
  
  const config = getOAuthProviderConfig(providerId)
  if (!config) {
    return c.html(`<h1>Server not configured</h1><p>Provider not configured</p>`, 500)
  }
  
  // Extract config properties we need
  const { tokenUrl, redirectUri, clientId } = config
  
  const code = c.req.query('code')
  const state = c.req.query('state')
  const error = c.req.query('error')
  const errorDescription = c.req.query('error_description')
  
  if (error) {
    return c.html(`
      <h1>OAuth Error</h1>
      <p>${errorDescription || error}</p>
      <a href="/keys">Back to Keys</a>
    `, 400)
  }
  
  if (!code || !state) {
    return c.html(`<h1>Invalid callback</h1><p>Missing code or state</p>`, 400)
  }
  
  // Get stored PKCE data
  const pkceData = pkceStore.get(state) as PkceData | undefined
  if (!pkceData || pkceData.provider !== providerId) {
    return c.html(`<h1>Invalid state</h1><p>State expired or invalid</p>`, 400)
  }
  
  pkceStore.delete(state)
  
  try {
     // Exchange code for tokens
     const tokenResponse = await fetch(tokenUrl, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/x-www-form-urlencoded',
         'Accept': 'application/json'
       },
       body: new URLSearchParams({
         grant_type: 'authorization_code',
         code,
         redirect_uri: redirectUri,
         client_id: clientId,
         code_verifier: pkceData.verifier
       })
     })
    
    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      return c.html(`<h1>Token exchange failed</h1><p>${error}</p>`, 502)
    }
    
    interface TokenResponse {
      access_token: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
    }
    const tokens = await tokenResponse.json() as TokenResponse
    
    // Store in user's vault
    const encryption = requireEncryptionKey(c.env)
    if (!encryption) {
      return c.html(`<h1>Server not configured</h1><p>ENCRYPTION_KEY not set</p>`, 500)
    }
    
    const { ciphertext: keyCiphertext, iv: keyIv } = await encryptSecret(tokens.access_token, encryption)
    
    let refreshCiphertext: string | null = null
    let refreshIv: string | null = null
    if (tokens.refresh_token) {
      const sealed = await encryptSecret(tokens.refresh_token, encryption)
      refreshCiphertext = sealed.ciphertext
      refreshIv = sealed.iv
    }
    
    const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null
    
    const id = newId()
    await c.env.DB.prepare(
      `INSERT INTO freellm_api_keys (id, user_id, provider, label, base_url, upstream_model,
                             key_ciphertext, key_iv, auth_kind, protocol, account_id,
                             refresh_ciphertext, refresh_iv, expires_at,
                             status, last_checked_at, last_error,
                             avg_latency_ms, active, messages_served, created_at, updated_at)
         VALUES (?, ?, 'byok', ?, ?, ?, ?, ?, 'oauth', 'openai', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
    ).bind(
      id,
      pkceData.userId,
      `${config.name} (Auto)`,
      '', // base_url - will be filled by provider-specific logic
      '', // upstream_model - will be filled by provider-specific logic
      keyCiphertext,
      keyIv,
      null, // account_id
      refreshCiphertext,
      refreshIv,
      expiresAt,
      'live',
      Date.now(),
      null,
      null,
      Date.now(),
      Date.now()
    ).run()
    
    // Redirect back to keys page with success
    return c.redirect('/keys?oauth=success')
  } catch (err) {
    return c.html(`<h1>Error</h1><p>${err instanceof Error ? err.message : 'Unknown error'}</p>`, 500)
  }
})

// =====================================================================
// Device code polling endpoint
// =====================================================================
app.post('/api/oauth/poll/:provider', async (c) => {
  const user = c.get('user')
  const providerId = c.req.param('provider')
  const body = await c.req.json().catch(() => ({}))
  const { state } = body
  
if (!isOAuthProvider(providerId)) {
     return c.json({ error: 'invalid_provider' }, 400)
   }
   
   const config = getOAuthProviderConfig(providerId)
   if (!config || config.flowType !== 'device_code') {
     return c.json({ error: 'not_device_flow' }, 400)
   }

   const { tokenUrl, clientId } = config
    
   const pkceData = pkceStore.get(`device:${state}`) as DeviceCodeData | undefined
   if (!pkceData || pkceData.provider !== providerId || pkceData.userId !== user.id) {
     return c.json({ error: 'invalid_state' }, 400)
   }
    
    // Define the interface outside the try block
    interface DeviceCodeTokenResponse {
      access_token: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      error?: string
      error_description?: string
    }
    
    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: pkceData.deviceCode,
          client_id: clientId
        })
      })
    
      const data = await response.json() as DeviceCodeTokenResponse
    
      if (data.error === 'authorization_pending') {
        return c.json({ status: 'pending' })
      }
    
      if (data.error === 'slow_down') {
        pkceData.interval += 5
        return c.json({ status: 'slow_down', interval: pkceData.interval })
      }
    
      if (data.error) {
        return c.json({ status: 'error', error: data.error })
      }
    
    // Success - store tokens
    const encryption = requireEncryptionKey(c.env)
    if (!encryption) {
      return c.json({ error: 'not_configured' }, 500)
    }
    
    const { ciphertext: keyCiphertext, iv: keyIv } = await encryptSecret(data.access_token, encryption)
    
    let refreshCiphertext: string | null = null
    let refreshIv: string | null = null
    if (data.refresh_token) {
      const sealed = await encryptSecret(data.refresh_token, encryption)
      refreshCiphertext = sealed.ciphertext
      refreshIv = sealed.iv
    }
    
    const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : null
    
    const id = newId()
    await c.env.DB.prepare(
      `INSERT INTO freellm_api_keys (id, user_id, provider, label, base_url, upstream_model,
                             key_ciphertext, key_iv, auth_kind, protocol, account_id,
                             refresh_ciphertext, refresh_iv, expires_at,
                             status, last_checked_at, last_error,
                             avg_latency_ms, active, messages_served, created_at, updated_at)
         VALUES (?, ?, 'byok', ?, ?, ?, ?, ?, 'oauth', 'openai', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
    ).bind(
      id,
      user.id,
      `${config.name} (Auto)`,
      '', // base_url
      '', // upstream_model
      keyCiphertext,
      keyIv,
      null, // account_id
      refreshCiphertext,
      refreshIv,
      expiresAt,
      'live',
      Date.now(),
      null,
      null,
      Date.now(),
      Date.now()
    ).run()
    
    pkceStore.delete(`device:${state}`)
    
    return c.json({ status: 'success', keyId: id })
  } catch (err) {
    return c.json({ status: 'error', error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

// =====================================================================
// Refresh token endpoint (on-demand refresh)
// =====================================================================
app.post('/api/keys/:id/refresh', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  
  const row = await c.env.DB.prepare('SELECT * FROM freellm_api_keys WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<ApiKeyRow>()
  
  if (!row) {
    return c.json({ error: 'not_found', message: 'Key not found.' }, 404)
  }
  
  if ((row.auth_kind ?? 'api_key') !== 'oauth') {
    return c.json({ error: 'not_oauth', message: 'Only OAuth keys can be refreshed.' }, 400)
  }
  
  if (!row.refresh_ciphertext || !row.refresh_iv) {
    return c.json({ error: 'no_refresh_token', message: 'No refresh token stored for this key.' }, 400)
  }
  
  const encryption = requireEncryptionKey(c.env)
  if (!encryption) {
    return c.json({ error: 'not_configured', message: 'ENCRYPTION_KEY not set.' }, 500)
  }
  
  const refreshToken = await decryptSecret(row.refresh_ciphertext, row.refresh_iv, encryption)
  
  // Determine provider from base_url or label
  let providerId: string | null = null
  if (row.base_url.includes('chatgpt.com') || row.label.toLowerCase().includes('codex')) {
    providerId = 'codex'
  } else if (row.base_url.includes('googleapis.com') || row.label.toLowerCase().includes('gemini') || row.label.toLowerCase().includes('google')) {
    providerId = 'google'
  } else if (row.base_url.includes('qoder') || row.label.toLowerCase().includes('qoder')) {
    providerId = 'qoder'
  } else if (row.base_url.includes('meta.com') || row.label.toLowerCase().includes('antigravity')) {
    providerId = 'antigravity'
  } else if (row.base_url.includes('x.ai') || row.label.toLowerCase().includes('grok')) {
    providerId = 'grok'
  }
  
  if (!providerId || !isOAuthProvider(providerId)) {
    return c.json({ error: 'unknown_provider', message: 'Cannot determine OAuth provider for this key.' }, 400)
  }
  
  const config = getOAuthProviderConfig(providerId)
  if (!config) {
    return c.json({ error: 'provider_not_configured' }, 500)
  }
  
  try {
    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId
      })
    })
    
    if (!response.ok) {
      const error = await response.text()
      return c.json({ error: 'refresh_failed', message: `Token refresh failed: ${error}` }, 502)
    }
    
interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}
    const tokens = await response.json() as TokenResponse
    
    // Update stored tokens
    const { ciphertext: keyCiphertext, iv: keyIv } = await encryptSecret(tokens.access_token, encryption)
    
    let newRefreshCiphertext = row.refresh_ciphertext
    let newRefreshIv = row.refresh_iv
    if (tokens.refresh_token) {
      const sealed = await encryptSecret(tokens.refresh_token, encryption)
      newRefreshCiphertext = sealed.ciphertext
      newRefreshIv = sealed.iv
    }
    
    const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null
    
    await c.env.DB.prepare(
      `UPDATE freellm_api_keys 
       SET key_ciphertext = ?, key_iv = ?, refresh_ciphertext = ?, refresh_iv = ?, expires_at = ?, updated_at = ?
       WHERE id = ?`
    ).bind(keyCiphertext, keyIv, newRefreshCiphertext, newRefreshIv, expiresAt, Date.now(), id).run()
    
    return c.json({ 
      ok: true, 
      expiresAt,
      message: 'Token refreshed successfully'
    })
  } catch (err) {
    return c.json({ error: 'refresh_failed', message: err instanceof Error ? err.message : 'Unknown error' }, 500)
  }
})

export default app