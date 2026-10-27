-- One-off admin credit grants with an optional expiry ("timer").
--
-- Unlike promo codes (claim-based, scoped or global), an admin grant is pushed
-- directly onto one user's global balance from the Users board. A grant with
-- an `expires_at` behaves like an expiring promo redemption: once past the
-- deadline, the unspent portion is clawed back by the lazy sweep in
-- functions/lib/credit-grants.ts (called wherever expirePromoCredits runs),
-- so timed grants can't be hoarded into a spend spike.
--
-- The credit ledger gains a 'grant_expiry' reason. The ledger is a leaf table
-- (nothing REFERENCES it), so the copy/rebuild/drop pattern is safe (see
-- 0017, 0026).

CREATE TABLE freellm_admin_grants (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  credits    INTEGER NOT NULL CHECK (credits > 0),
  expires_at INTEGER,                            -- NULL = never expires
  expired_at INTEGER,                            -- set once the unspent portion is clawed back
  note       TEXT,                                -- operator note, e.g. "contest winner"
  created_by TEXT,                                -- granting admin's user id
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_freellm_admin_grants_user ON freellm_admin_grants(user_id, created_at DESC);

-- Partial index for the lazy sweep: a user's un-clawed grants past deadline.
CREATE INDEX idx_freellm_admin_grants_expiry
  ON freellm_admin_grants(user_id, expires_at) WHERE expired_at IS NULL;

CREATE TABLE freellm_credit_ledger_new (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN (
               'signup_bonus', 'daily_checkin', 'referral_reward',
               'key_contribution', 'key_upkeep', 'task_reward',
               'admin_grant', 'chat_spend', 'refund', 'promo_code',
               'game_reward', 'promo_expiry', 'grant_expiry'
             )),
  meta       TEXT,
  created_at INTEGER NOT NULL
);

INSERT INTO freellm_credit_ledger_new (id, user_id, delta, reason, meta, created_at)
  SELECT id, user_id, delta, reason, meta, created_at FROM freellm_credit_ledger;

DROP TABLE freellm_credit_ledger;

ALTER TABLE freellm_credit_ledger_new RENAME TO freellm_credit_ledger;

CREATE INDEX idx_freellm_credit_ledger_user_time ON freellm_credit_ledger(user_id, created_at DESC);
CREATE INDEX idx_freellm_credit_ledger_reason ON freellm_credit_ledger(reason, created_at DESC);
