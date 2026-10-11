-- M3 metering core: output caps + transient credit holds.
--
-- credit_holds implement reserve-settle: a hold is placed before proxying
-- and released when the request settles, so concurrent streams can't
-- overspend a user's balance. Stale holds (>10 min) are ignored on read
-- and cleaned opportunistically.

ALTER TABLE freellm_models ADD COLUMN max_output_tokens INTEGER NOT NULL DEFAULT 4096;

CREATE TABLE freellm_credit_holds (
  request_id TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL CHECK (amount >= 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_freellm_credit_holds_user ON freellm_credit_holds(user_id);
