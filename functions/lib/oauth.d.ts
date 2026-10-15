export interface OAuthProviderConfig {
  name: string;
  authorizeUrl?: string;
  tokenUrl: string;
  deviceCodeUrl?: string;
  clientId: string;
  scope: string;
  flowType: 'authorization_code_pkce' | 'authorization_code' | 'device_code';
  redirectUri: string;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig>;

export function getOAuthProviderConfig(providerId: string): OAuthProviderConfig | undefined;

export function isOAuthProvider(providerId: string): boolean;

export const OAUTH_PROVIDER_LIST: Array<{ id: string; name: string }>;