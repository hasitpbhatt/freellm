// Shared runtime types.

export type Bindings = {
  DB: D1Database
  freellm_sessions: KVNamespace
  ENVIRONMENT: string
  ENCRYPTION_KEY: string
  ADMIN_EMAIL?: string
  MAIL_FROM?: string
  RESEND_API_KEY?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  PUBLIC_ORIGIN?: string
}

import type { ModelTier } from './tiers'

export type UserRow = {
  id: string
  email: string
  username: string
  display_name: string | null
  avatar_url: string | null
  password_hash: string | null
  referral_code: string
  balance_credits: number
  role: 'user' | 'admin'
  tier: ModelTier
  email_verified: number
  referred_by: string | null
  created_at: number
  updated_at: number
}

export type PublicUser = Omit<UserRow, 'password_hash'>

export type ModelRow = {
  id: string
  slug: string
  label: string
  description: string | null
  capabilities: string
  context_window: number | null
  max_output_tokens: number
  flat_rate_credits: number
  routing: 'round_robin' | 'random' | 'failover' | 'latency_weighted'
  access_tier: ModelTier
  active: number
  sort_order: number
  created_at: number
  updated_at: number
}

export type ModelProviderRow = {
  id: string
  model_id: string
  label: string
  base_url: string
  upstream_model: string
  api_key_ciphertext: string
  api_key_iv: string
  status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
  last_checked_at: number | null
  last_error: string | null
  avg_latency_ms: number | null
  cooldown_until: number | null
  priority: number
  active: number
  messages_served: number
  consecutive_failures: number
  created_at: number
  updated_at: number
}

export type ApiKeyRow = {
  id: string
  user_id: string
  provider: 'byok'
  label: string
  base_url: string
  upstream_model: string
  key_ciphertext: string
  key_iv: string
  status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
  last_checked_at: number | null
  last_error: string | null
  avg_latency_ms: number | null
  active: number
  messages_served: number
  created_at: number
  updated_at: number
}

export type Variables = {
  user: UserRow
}
