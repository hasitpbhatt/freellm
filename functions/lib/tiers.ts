// Access tiering: which callers may use which model aliases.
// Ranks: free < pro < enterprise. Admins bypass all gates.

export type ModelTier = 'free' | 'pro' | 'enterprise'

export const MODEL_TIERS: ModelTier[] = ['free', 'pro', 'enterprise']

const TIER_RANK: Record<ModelTier, number> = { free: 0, pro: 1, enterprise: 2 }

/** Unknown/junk tier strings fall back to the most restrictive safe default. */
export function parseTier(value: unknown): ModelTier {
  return value === 'free' || value === 'pro' || value === 'enterprise' ? value : 'free'
}

export function tierRank(tier: ModelTier): number {
  return TIER_RANK[tier]
}

/**
 * Server-side gate: admins use everything; everyone else needs
 * rank(userTier) >= rank(modelTier). Unknown model tiers deny by default.
 */
export function canAccessModel(
  user: { tier?: unknown; role?: string },
  model: { access_tier?: unknown },
): boolean {
  if (user.role === 'admin') return true
  const need = model.access_tier
  if (need !== 'free' && need !== 'pro' && need !== 'enterprise') return false
  return tierRank(parseTier(user.tier)) >= TIER_RANK[need]
}

/** 403 message naming the required tier so the caller knows how to upgrade. */
export function tierGatedMessage(model: { label?: string; access_tier?: unknown }): string {
  const label = typeof model.label === 'string' && model.label ? model.label : 'This model'
  const need = model.access_tier === 'pro' || model.access_tier === 'enterprise' ? model.access_tier : 'pro'
  return `${label} requires a ${need} tier. Contact an admin to upgrade — no charge was made.`
}
