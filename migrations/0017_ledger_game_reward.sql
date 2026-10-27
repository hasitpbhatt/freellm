-- Ledger reason taxonomy: add game_reward for the reaction-sprint payouts.
-- No table references the ledger, so a copy/rebuild/drop cycle loses no
-- child rows (unlike the 0011 incident — see its header comment).

CREATE TABLE freellm_credit_ledger_new (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN (
               'signup_bonus', 'daily_checkin', 'referral_reward',
               'key_contribution', 'key_upkeep', 'task_reward',
               'admin_grant', 'chat_spend', 'refund', 'promo_code',
               'game_reward'
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
