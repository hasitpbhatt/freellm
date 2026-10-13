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
  scoped_only: number
  active: number
  sort_order: number
  created_at: number
  updated_at: number
}

/** Upstream provider (Poolside, OpenAI, etc.) — the shared endpoint.
 *
 *  A provider owns N bearer keys in `freellm_upstream_keys` (one base_url can
 *  be served by several keys, e.g. one per team seat or quota bucket). The
 *  health columns here are the *endpoint rollup* across its keys; per-key
 *  health lives on UpstreamKeyRow and is what actually rotates keys. */
export type UpstreamProviderRow = {
  id: string
  label: string
  base_url: string
  status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
  last_checked_at: number | null
  last_error: string | null
  avg_latency_ms: number | null
  consecutive_failures: number
  cooldown_until: number | null
  cooldown_base_ms: number | null
  created_at: number
  updated_at: number
}

/** One bearer key in an upstream provider's pool. Rotated by health: a key
 *  that hits a quota (429) cools down on its own without sidelining the rest. */
export type UpstreamKeyRow = {
  id: string
  upstream_provider_id: string
  label: string
  api_key_ciphertext: string
  api_key_iv: string
  status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
  consecutive_failures: number
  cooldown_until: number | null
  last_used_at: number | null
  last_error: string | null
  priority: number
  created_at: number
  updated_at: number
}

/** Upstream model catalog entry with capabilities. */
export type UpstreamModelRow = {
  upstream_provider_id: string
  upstream_model: string
  capabilities: string | null
  context_window: number | null
  max_output_tokens: number | null
  supports_streaming: number
}

/** Upstream provider with its model capabilities and key pool (for routing). */
export type UpstreamProviderWithModel = UpstreamProviderRow & {
  model_capabilities: string[]
  keys: UpstreamKeyRow[]
  supports_streaming: number
}

/** Model provider mapping: alias -> upstream provider + upstream_model. */
export type ModelProviderRow = {
  id: string
  model_id: string
  upstream_provider_id: string
  upstream_model: string
  priority: number
  active: number
  messages_served: number
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