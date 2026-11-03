-- Double-sided referral milestones
-- Allows partial payouts at multiple milestones instead of single lump sum

CREATE TABLE IF NOT EXISTS freellm_referral_milestones (
    id TEXT PRIMARY KEY,           -- deterministic: "referral_milestone:{referral_id}:{milestone_type}"
    referral_id TEXT NOT NULL REFERENCES freellm_referrals(id) ON DELETE CASCADE,
    milestone_type TEXT NOT NULL,  -- 'signup', 'day1_checkin', 'tenure_7', 'tokens_200k'
    referrer_reward INTEGER NOT NULL DEFAULT 0,
    referred_reward INTEGER NOT NULL DEFAULT 0,
    paid_at INTEGER,               -- when this milestone was paid (both sides)
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_freellm_referral_milestones_referral ON freellm_referral_milestones(referral_id);
CREATE INDEX IF NOT EXISTS idx_freellm_referral_milestones_paid ON freellm_referral_milestones(paid_at) WHERE paid_at IS NOT NULL;

-- New referral statuses: waiting -> signup_paid -> day1_paid -> tenure_paid/tokens_paid -> fully_paid
-- We keep 'waiting' and 'paid' for backward compatibility but track milestones separately