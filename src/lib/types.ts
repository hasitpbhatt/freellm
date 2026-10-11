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
  base_url: string
  upstream_model: string
  key_masked: string
  status: 'unknown' | 'live' | 'slow' | 'down' | 'disabled'
  last_checked_at: number | null
  last_error: string | null
  avg_latency_ms: number | null
  priority: number
  active: number
  messages_served: number
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
  active: number
  sort_order: number
  created_at: number
  updated_at: number
  providers: ModelProvider[]
}
