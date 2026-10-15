export type User = {
  id: string
  email: string
  username: string
  display_name: string | null
  avatar_url: string | null
  referral_code: string
  balance_credits: number
  role: 'user' | 'admin'
  tier: 'free' | 'pro' | 'enterprise'
  email_verified: number
  referred_by: string | null
  created_at: number
  updated_at: number
}

export type ModelProvider = {
  id: string
  label: string
  upstream_provider_id: string
  upstream_model: string
  base_url: string
  key_masked: string
  key_count?: number
  status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
  last_checked_at: number | null
  last_error: string | null
  avg_latency_ms: number | null
  priority: number
  active: number
  messages_served: number
  cooldown_base_ms: number | null
}

/** A shared upstream provider (Poolside, OpenAI, …) — one base URL, N bearer
 *  keys, many aliases. Health columns are the endpoint rollup across its keys. */
export type UpstreamProvider = {
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
  /** Masked primary (first) key, for the compact provider row. */
  key_masked?: string
  /** How many keys the provider's pool holds. */
  key_count?: number
  /** The full key pool (masked), when the response includes it. */
  keys?: UpstreamKey[]
}

/** One bearer key in an upstream provider's pool. A 429 cools only this key. */
export type UpstreamKey = {
  id: string
  label: string
  status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
  key_masked?: string
  consecutive_failures: number
  cooldown_until: number | null
  last_used_at: number | null
  last_error: string | null
  priority: number
  /** Plaintext key, only present on reveal endpoints. */
  api_key?: string
}

/** A canonical model name registered under an upstream provider. */
export type UpstreamModel = {
  upstream_provider_id: string
  upstream_model: string
  capabilities: string | null
  context_window: number | null
  max_output_tokens: number | null
  supports_streaming: number
  provider_label?: string
}

export type ModelAlias = {
  id: string
  slug: string
  label: string
  description: string | null
  capabilities: string[]
  context_window: number | null
  max_output_tokens: number
  flat_rate_credits: number
  routing: 'round_robin' | 'random' | 'failover' | 'latency_weighted'
  access_tier: 'free' | 'pro' | 'enterprise'
  scoped_only: number
  active: number
  sort_order: number
  created_at: number
  updated_at: number
  providers: ModelProvider[]
}
