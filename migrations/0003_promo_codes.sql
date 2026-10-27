-- Promo codes: admin-issued credit grants that consumers redeem.
-- A code is either global (any model) or scoped to one alias, in which case
-- the tokens land in that model's grant balance (model_credit_grants).

CREATE TABLE freellm_promo_codes (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,     -- stored uppercase, e.g. LAUNCH-2026
  description           TEXT,
  credits               INTEGER NOT NULL CHECK (credits > 0),
  model_id              TEXT REFERENCES freellm_models(id) ON DELETE SET NULL, -- NULL = any model
  max_redemptions       INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemption_count      INTEGER NOT NULL DEFAULT 0,
  per_user_limit        INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  min_account_age_hours INTEGER NOT NULL DEFAULT 0 CHECK (min_account_age_hours >= 0),
  starts_at             INTEGER,                  -- NULL = live immediately
  expires_at            INTEGER,                  -- NULL = never expires
  active                INTEGER NOT NULL DEFAULT 1,
  created_by            TEXT REFERENCES freellm_users(id) ON DELETE SET NULL,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX idx_freellm_promo_codes_active ON freellm_promo_codes(active, expires_at);

CREATE TABLE freellm_promo_redemptions (
  id            TEXT PRIMARY KEY,
  promo_code_id TEXT NOT NULL REFERENCES freellm_promo_codes(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  credits       INTEGER NOT NULL,
  model_id      TEXT,                             -- snapshot of the scope at redemption time
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_freellm_promo_redemptions_code ON freellm_promo_redemptions(promo_code_id);
CREATE INDEX idx_freellm_promo_redemptions_user ON freellm_promo_redemptions(user_id, created_at DESC);

-- Per-model credit balances. A user's spendable total for model X is
-- users.balance_credits + model_credit_grants.credits for X. Spending
-- (M3) drains the model-scoped grant first, then global.
CREATE TABLE freellm_model_credit_grants (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  model_id   TEXT NOT NULL REFERENCES freellm_models(id) ON DELETE CASCADE,
  credits    INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, model_id)
);
CREATE INDEX idx_freellm_model_credit_grants_user ON freellm_model_credit_grants(user_id);
