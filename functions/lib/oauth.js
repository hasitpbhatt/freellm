// OAuth provider configurations for freellm
// Based on 9router patterns but simplified for manual entry + auto-refresh

// Base URL for OAuth callbacks (should be set via env in production)
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// OAuth provider configurations
export const OAUTH_PROVIDERS = {
  // Codex (ChatGPT) - Authorization Code Flow with PKCE
  codex: {
    name: 'Codex (ChatGPT)',
    authorizeUrl: 'https://chatgpt.com/backend-api/codex/oauth/authorize',
    tokenUrl: 'https://chatgpt.com/backend-api/codex/oauth/token',
    clientId: 'your-client-id-here', // Would need to be registered with ChatGPT
    scope: 'openai off_access', // ChatGPT Codex scopes
    flowType: 'authorization_code_pkce',
    redirectUri: `${BASE_URL}/api/oauth/callback/codex`,
    // Note: For freellm, we'll rely on manual entry primarily, but this enables auto-connect
  },
  
  // Google / Gemini - Authorization Code Flow
  google: {
    name: 'Google / Gemini',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: 'your-client-id-here', // Would need Google Cloud project
    scope: 'openid email profile https://www.googleapis.com/auth/generative-language',
    flowType: 'authorization_code',
    redirectUri: `${BASE_URL}/api/oauth/callback/google`,
  },
  
  // Qoder - Device Code Flow (based on 9router)
  qoder: {
    name: 'Qoder',
    deviceCodeUrl: 'https://center.qoder.sh/oauth/device_code',
    tokenUrl: 'https://center.qoder.sh/oauth/token',
    clientId: 'your-client-id-here', // Would need Qoder registration
    scope: 'openid profile email',
    flowType: 'device_code',
    redirectUri: `${BASE_URL}/api/oauth/callback/qoder`, // Not used for device flow but kept for consistency
  },
  
  // Antigravity - Standard OAuth2 with Google
  antigravity: {
    name: 'Antigravity',
    authorizeUrl: 'https://auth.meta.com/oauth/authorize',
    tokenUrl: 'https://auth.meta.com/oauth/token',
    clientId: 'your-client-id-here', // Would need Meta/antigravity registration
    scope: 'openid email profile',
    flowType: 'authorization_code',
    redirectUri: `${BASE_URL}/api/oauth/callback/antigravity`,
  },
  
  // Grok Build / xAI - Device Code Flow
  grok: {
    name: 'Grok Build (xAI)',
    deviceCodeUrl: 'https://auth.x.ai/device/code',
    tokenUrl: 'https://auth.x.ai/token',
    clientId: 'your-client-id-here', // Would need xAI registration
    scope: 'openid profile email',
    flowType: 'device_code',
    redirectUri: `${BASE_URL}/api/oauth/callback/grok`,
  }
};

// Helper to get provider config
export function getOAuthProviderConfig(providerId) {
  return OAUTH_PROVIDERS[providerId];
}

// Helper to check if provider supports OAuth
export function isOAuthProvider(providerId) {
  return !!OAUTH_PROVIDERS[providerId];
}

// List of providers that support OAuth for UI
export const OAUTH_PROVIDER_LIST = [
  { id: 'codex', name: 'Codex (ChatGPT)' },
  { id: 'google', name: 'Google / Gemini' },
  { id: 'qoder', name: 'Qoder' },
  { id: 'antigravity', name: 'Antigravity' },
  { id: 'grok', name: 'Grok Build (xAI)' }
];