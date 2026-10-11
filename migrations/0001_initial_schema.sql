-- freellm initial schema
-- Conventions:
--   * all timestamps are unix epoch milliseconds (INTEGER)
--   * ids are ULIDs/UUIDs generated app-side (TEXT)
--   * credit amounts are integer tokens; 1 credit = 1 token

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- users
CREATE TABLE freellm_users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  username        TEXT NOT NULL UNIQUE,
  display_name    TEXT,
  avatar_url      TEXT,
  password_hash   TEXT,                          -- NULL for OAuth-only users
  referral_code   TEXT NOT NULL UNIQUE,          -- short code used in /r/<code> links
  balance_credits INTEGER NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  email_verified  INTEGER NOT NULL DEFAULT 0,
  referred_by     TEXT REFERENCES freellm_users(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_freellm_users_referred_by ON freellm_users(referred_by);

-- Multiple auth methods per user (password, google, ... later)
CREATE TABLE freellm_auth_identities (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL CHECK (provider IN ('password', 'google')),
  subject        TEXT NOT NULL,                  -- google sub, or 'password' for local
  email          TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  UNIQUE (provider, subject)
);
CREATE INDEX idx_freellm_auth_identities_user ON freellm_auth_identities(user_id);

-- ------------------------------------------------------- credit ledger
-- Append-only audit trail of every credit change. The user's balance is
-- authoritatively derivable as SUM(delta); the users.balance_credits
-- column is a cached projection updated in the same transaction.
CREATE TABLE freellm_credit_ledger (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,                   -- +earned / -spent
  reason     TEXT NOT NULL CHECK (reason IN (
               'signup_bonus', 'daily_checkin', 'referral_reward',
               'key_contribution', 'key_upkeep', 'task_reward',
               'admin_grant', 'chat_spend', 'refund', 'promo_code'
             )),
  meta       TEXT,                               -- JSON: {model, request_id, streak, task_id, ...}
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_freellm_credit_ledger_user_time ON freellm_credit_ledger(user_id, created_at DESC);
CREATE INDEX idx_freellm_credit_ledger_reason ON freellm_credit_ledger(reason, created_at DESC);

-- ------------------------------------------------------- usage events
-- The metering ledger: one row per chat request. request_id is UNIQUE so
-- retries/reconnects can never double-charge. source records whether the
-- numbers came from the provider or the flat-rate fallback.
CREATE TABLE freellm_usage_events (
  id              TEXT PRIMARY KEY,
  request_id      TEXT NOT NULL UNIQUE,
  user_id         TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  model           TEXT NOT NULL,
  provider        TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('reported', 'flat_rate')),
  input_tokens    INTEGER,                       -- NULL when unavailable
  output_tokens   INTEGER,
  total_tokens    INTEGER,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL CHECK (status IN ('completed', 'aborted', 'failed')),
  key_mode        TEXT NOT NULL CHECK (key_mode IN ('pool', 'byok')),
  latency_ms      INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_freellm_usage_events_user_time ON freellm_usage_events(user_id, created_at DESC);
CREATE INDEX idx_freellm_usage_events_model_time ON freellm_usage_events(model, created_at DESC);
CREATE INDEX idx_freellm_usage_events_status ON freellm_usage_events(status, created_at DESC);

-- ------------------------------------------------------------ checkins
CREATE TABLE freellm_checkins (
  user_id      TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  checkin_date TEXT NOT NULL,                    -- YYYY-MM-DD (UTC)
  streak       INTEGER NOT NULL DEFAULT 1,
  reward       INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, checkin_date)
);

-- ----------------------------------------------------------- referrals
-- Referrer is paid only after the referred user hits a milestone
-- (7-day tenure OR 200K tokens used), per the anti-farming design.
CREATE TABLE freellm_referrals (
  id           TEXT PRIMARY KEY,
  referrer_id  TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  referred_id  TEXT NOT NULL UNIQUE REFERENCES freellm_users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'qualified', 'paid', 'rejected')),
  milestone    TEXT,                             -- JSON: {tenure_days_needed, tokens_needed, tenure_days, tokens_used}
  reward       INTEGER,
  qualified_at INTEGER,
  paid_at      INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_freellm_referrals_referrer ON freellm_referrals(referrer_id, status);

-- --------------------------------------------------------------- tasks
CREATE TABLE freellm_tasks (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  reward      INTEGER NOT NULL,
  url         TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE freellm_task_completions (
  user_id     TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  task_id     TEXT NOT NULL REFERENCES freellm_tasks(id) ON DELETE CASCADE,
  reward      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id)
);

-- ------------------------------------------------------- BYOK key vault
CREATE TABLE freellm_api_keys (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL,
  label                   TEXT NOT NULL,
  key_ciphertext          TEXT NOT NULL,         -- AES-256-GCM ciphertext (base64)
  key_iv                  TEXT NOT NULL,         -- 12-byte IV (base64)
  contributed             INTEGER NOT NULL DEFAULT 0,   -- shared to The Pool
  contribution_reward_paid INTEGER NOT NULL DEFAULT 0,
  last_alive_at           INTEGER,
  last_error              TEXT,
  messages_served         INTEGER NOT NULL DEFAULT 0,   -- impact stat for contributed keys
  created_at              INTEGER NOT NULL
);
CREATE INDEX idx_freellm_api_keys_user ON freellm_api_keys(user_id);
CREATE INDEX idx_freellm_api_keys_pool ON freellm_api_keys(contributed, provider);

-- -------------------------------------------------------------- battles
CREATE TABLE freellm_battles (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  prompt     TEXT NOT NULL,
  models     TEXT NOT NULL,                      -- JSON array of model ids
  status     TEXT NOT NULL DEFAULT 'streaming' CHECK (status IN ('streaming', 'complete', 'failed')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_freellm_battles_created ON freellm_battles(created_at DESC);

CREATE TABLE freellm_battle_votes (
  battle_id  TEXT NOT NULL REFERENCES freellm_battles(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (battle_id, user_id)
);

-- ------------------------------------------------------- default tasks
INSERT INTO freellm_tasks (id, slug, title, description, reward, url, sort_order, active, created_at) VALUES
  ('task_star_gh', 'star_gh', 'Star CodeWhip on GitHub', 'Star the CodeWhip repository to earn credits. Visit https://github.com/hasitpbhatt/codewhip, star the project, then claim your reward.', 1000000, 'https://github.com/hasitpbhatt/codewhip', 1, 1, unixepoch() * 1000);

-- --------------------------------------------- email verification tokens
-- The gate for earning credits and pool usage (anti-farming). Password
-- users get a token by email; Google users are verified by Google itself.
CREATE TABLE freellm_email_verifications (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_freellm_email_verifications_user ON freellm_email_verifications(user_id, consumed_at);
