-- Wave 0 money integrity. Three holes, three schema guarantees:
--
-- 1. freellm_game_rounds had no attempt/move counters, so chess `attempts`
--    and memory `moves` were client-reported at claim time. A wrong chess
--    move returned 422 with no side effect, which made the tier counter
--    free to lie (probe the solution, then claim with attempts=1). Memory
--    `moves` was never verifiable at all. Now the server keeps an
--    authoritative count per round and the claim derives reward from it.
--    The dead `reaction_ms` column from 0016 is left in place (SQLite can
--    only drop columns in newer versions and nothing reads it).
--
-- 2. freellm_promo_redemptions had no UNIQUE(promo_code_id, user_id): the
--    per-user limit was a racy COUNT(*) read, so N parallel redeems all
--    read 0 and all granted. Dedupe first (keep the earliest), then
--    enforce at the schema level.
--
-- 3. The stale-hold sweep ran table-wide on every chat request with no
--    index on created_at; the daily-cap and cap queries filter claimed_at
--    after the user seek. Both get a covering index.

ALTER TABLE freellm_game_rounds ADD COLUMN flips INTEGER NOT NULL DEFAULT 0;
ALTER TABLE freellm_game_rounds ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_freellm_game_rounds_claims
  ON freellm_game_rounds(user_id, game, claimed_at);

DELETE FROM freellm_promo_redemptions
WHERE rowid NOT IN (
  SELECT MIN(rowid) FROM freellm_promo_redemptions GROUP BY promo_code_id, user_id
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_freellm_promo_redemptions_user
  ON freellm_promo_redemptions(promo_code_id, user_id);

CREATE INDEX IF NOT EXISTS idx_freellm_credit_holds_created
  ON freellm_credit_holds(created_at);
