-- Promo credit expiry. A promo code's `expires_at` gates *redemption*; this
-- migration makes the *grant* expire too. Redemptions snapshot the code's
-- expiry, and once it passes the unspent portion of the grant is clawed back
-- from the pooled balance (per-model grant for scoped promos, global balance
-- otherwise), so expiring promos can't be hoarded into a spend spike.
--
-- The credit ledger gains a 'promo_expiry' reason. The ledger is a leaf table
-- (nothing REFERENCES it), so the copy/rebuild/drop pattern is safe (see 0017).

ALTER TABLE freellm_promo_redemptions ADD COLUMN expires_at INTEGER;
ALTER TABLE freellm_promo_redemptions ADD COLUMN expired_at INTEGER;

-- Partial index for the lazy sweep: finds a user's unexpired, un-clawed
-- redemptions that are now past their deadline.
CREATE INDEX IF NOT EXISTS idx_freellm_promo_redemptions_expiry
  ON freellm_promo_redemptions(user_id, expires_at) WHERE expired_at IS NULL;

CREATE TABLE freellm_credit_ledger_new (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN (
               'signup_bonus', 'daily_checkin', 'referral_reward',
               'key_contribution', 'key_upkeep', 'task_reward',
               'admin_grant', 'chat_spend', 'refund', 'promo_code',
               'game_reward', 'promo_expiry'
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
