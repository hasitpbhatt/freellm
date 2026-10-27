-- Upstream provider key pools.
--
-- One row per (endpoint, key) instead of one row per key. Same base_url now
-- means one provider with N bearer keys, one model catalog, one health
-- record — so "Mingles.ai #1/#2/#3" become one provider with three keys,
-- and duplicate providers by base_url are merged into a single canonical.
--
-- Nothing is destroyed:
--   * keys are copied verbatim (ciphertext+iv; only ENCRYPTION_KEY decrypts them)
--   * pre-migration snapshots of all three tables are kept in *_0025_backup
--     tables; rollback is SQL, not a D1 restore
--   * the legacy api_key_* columns on freellm_upstream_providers are NOT
--     dropped here (0026 drops them after the new code has soaked)

-- 1. Key pool table.
CREATE TABLE IF NOT EXISTS freellm_upstream_keys (
  id                   TEXT PRIMARY KEY,
  upstream_provider_id TEXT NOT NULL REFERENCES freellm_upstream_providers(id) ON DELETE CASCADE,
  label                TEXT NOT NULL,
  api_key_ciphertext   TEXT NOT NULL,
  api_key_iv           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'live', 'slow', 'down', 'disabled')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  cooldown_until       INTEGER,
  last_used_at         INTEGER,
  priority             INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_freellm_upstream_keys_pool
  ON freellm_upstream_keys(upstream_provider_id, status, cooldown_until);

-- 2. Pre-migration snapshots (CREATE IF NOT EXISTS: a crashed first run keeps
--    the original state, a re-run never overwrites it).
CREATE TABLE IF NOT EXISTS freellm_upstream_providers_0025_backup AS
  SELECT * FROM freellm_upstream_providers;
CREATE TABLE IF NOT EXISTS freellm_upstream_models_0025_backup AS
  SELECT * FROM freellm_upstream_models;
CREATE TABLE IF NOT EXISTS freellm_model_providers_0025_backup AS
  SELECT * FROM freellm_model_providers;

-- 3. Backfill one key per existing provider (guarded so re-runs converge).
INSERT INTO freellm_upstream_keys (
  id, upstream_provider_id, label, api_key_ciphertext, api_key_iv,
  status, consecutive_failures, cooldown_until, priority, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))),
  id,
  'default',
  api_key_ciphertext,
  api_key_iv,
  status,
  consecutive_failures,
  cooldown_until,
  0,
  created_at,
  updated_at
FROM freellm_upstream_providers
WHERE id NOT IN (SELECT upstream_provider_id FROM freellm_upstream_keys);

-- 4. Deterministic canonical per base_url: live > slow > unknown > down/
--    disabled, then most recently checked, then oldest row.
DROP TABLE IF EXISTS canonical_0025;
CREATE TABLE canonical_0025 AS
SELECT base_url, canonical_id FROM (
  SELECT p.base_url AS base_url,
         p.id AS canonical_id,
         ROW_NUMBER() OVER (
           PARTITION BY p.base_url
           ORDER BY CASE p.status
                      WHEN 'live' THEN 0 WHEN 'slow' THEN 1
                      WHEN 'unknown' THEN 2 WHEN 'down' THEN 3 ELSE 4 END,
                  COALESCE(p.last_checked_at, 0) DESC,
                  p.created_at ASC,
                  p.id ASC
         ) AS rn
  FROM freellm_upstream_providers p
)
WHERE rn = 1;

-- 5. Survivors for collapsing duplicate alias configs within a canonical
--    group (same model_id + upstream_model + base_url): best priority, then
--    lowest id. Every non-duplicate row is trivially its own survivor.
DROP TABLE IF EXISTS mp_survivors_0025;
CREATE TABLE mp_survivors_0025 AS
SELECT mp.id
FROM freellm_model_providers mp
JOIN freellm_upstream_providers p ON p.id = mp.upstream_provider_id
WHERE mp.id = (
  SELECT x.id
  FROM freellm_model_providers x
  JOIN freellm_upstream_providers px ON px.id = x.upstream_provider_id
  WHERE x.model_id = mp.model_id
    AND x.upstream_model = mp.upstream_model
    AND px.base_url = p.base_url
  ORDER BY x.priority ASC, x.id ASC
  LIMIT 1
);

-- 6. Sum the losers' served counts into the survivors before deleting them.
UPDATE freellm_model_providers
SET messages_served = messages_served + (
  SELECT COALESCE(SUM(x.messages_served), 0)
  FROM freellm_model_providers x
  JOIN freellm_upstream_providers px ON px.id = x.upstream_provider_id
  JOIN freellm_upstream_providers ps ON ps.id = freellm_model_providers.upstream_provider_id
  WHERE x.model_id = freellm_model_providers.model_id
    AND x.upstream_model = freellm_model_providers.upstream_model
    AND px.base_url = ps.base_url
    AND x.id NOT IN (SELECT id FROM mp_survivors_0025)
)
WHERE id IN (SELECT id FROM mp_survivors_0025);

-- 7. Delete the collapsed duplicates (before repointing, so base_url is intact).
DELETE FROM freellm_model_providers WHERE id NOT IN (SELECT id FROM mp_survivors_0025);

-- 8. Relabel loser keys while still attached to their own provider, then move
--    them to the canonical. Labels collide only visually, so prefix them.
UPDATE freellm_upstream_keys
SET label = (SELECT p.label FROM freellm_upstream_providers p WHERE p.id = freellm_upstream_keys.upstream_provider_id)
WHERE upstream_provider_id IN (
  SELECT p.id FROM freellm_upstream_providers p
  JOIN canonical_0025 c ON c.base_url = p.base_url
  WHERE p.id <> c.canonical_id
);

UPDATE freellm_upstream_keys
SET upstream_provider_id = (
  SELECT c.canonical_id FROM canonical_0025 c
  JOIN freellm_upstream_providers p ON p.base_url = c.base_url
  WHERE p.id = freellm_upstream_keys.upstream_provider_id
)
WHERE upstream_provider_id IN (
  SELECT p.id FROM freellm_upstream_providers p
  JOIN canonical_0025 c ON c.base_url = p.base_url
  WHERE p.id <> c.canonical_id
);

-- 9. Models: move any model the canonical lacks (INSERT OR IGNORE on the
--    (provider, model) PK), then drop the losers' catalog rows.
INSERT OR IGNORE INTO freellm_upstream_models (upstream_provider_id, upstream_model, capabilities, context_window, max_output_tokens)
SELECT c.canonical_id, m.upstream_model, m.capabilities, m.context_window, m.max_output_tokens
FROM freellm_upstream_models m
JOIN freellm_upstream_providers p ON p.id = m.upstream_provider_id
JOIN canonical_0025 c ON c.base_url = p.base_url
WHERE m.upstream_provider_id <> c.canonical_id;

DELETE FROM freellm_upstream_models
WHERE upstream_provider_id IN (
  SELECT p.id FROM freellm_upstream_providers p
  JOIN canonical_0025 c ON c.base_url = p.base_url
  WHERE p.id <> c.canonical_id
);

-- 10. Repoint alias configs to the canonical (must precede the delete —
--     model_providers.upstream_provider_id is ON DELETE RESTRICT).
UPDATE freellm_model_providers
SET upstream_provider_id = (
  SELECT c.canonical_id FROM canonical_0025 c
  JOIN freellm_upstream_providers p ON p.base_url = c.base_url
  WHERE p.id = freellm_model_providers.upstream_provider_id
)
WHERE upstream_provider_id IN (
  SELECT p.id FROM freellm_upstream_providers p
  JOIN canonical_0025 c ON c.base_url = p.base_url
  WHERE p.id <> c.canonical_id
);

-- 11. Merge loser health into the canonical: best status, max failures,
--     latest cooldown/check, keep EWMA when the canonical has one.
UPDATE freellm_upstream_providers
SET status = (
      SELECT CASE MIN(r) WHEN 0 THEN 'live' WHEN 1 THEN 'slow'
                         WHEN 2 THEN 'unknown' WHEN 3 THEN 'down' ELSE 'disabled' END
      FROM (
        SELECT CASE p2.status WHEN 'live' THEN 0 WHEN 'slow' THEN 1
                              WHEN 'unknown' THEN 2 WHEN 'down' THEN 3 ELSE 4 END AS r
        FROM freellm_upstream_providers p2
        JOIN canonical_0025 c2 ON c2.base_url = p2.base_url
        WHERE c2.canonical_id = freellm_upstream_providers.id
      )
    ),
    consecutive_failures = (
      SELECT MAX(p2.consecutive_failures)
      FROM freellm_upstream_providers p2
      JOIN canonical_0025 c2 ON c2.base_url = p2.base_url
      WHERE c2.canonical_id = freellm_upstream_providers.id
    ),
    cooldown_until = (
      SELECT MAX(p2.cooldown_until)
      FROM freellm_upstream_providers p2
      JOIN canonical_0025 c2 ON c2.base_url = p2.base_url
      WHERE c2.canonical_id = freellm_upstream_providers.id
    ),
    last_checked_at = (
      SELECT MAX(p2.last_checked_at)
      FROM freellm_upstream_providers p2
      JOIN canonical_0025 c2 ON c2.base_url = p2.base_url
      WHERE c2.canonical_id = freellm_upstream_providers.id
    ),
    avg_latency_ms = COALESCE(avg_latency_ms, (
      SELECT MAX(p2.avg_latency_ms)
      FROM freellm_upstream_providers p2
      JOIN canonical_0025 c2 ON c2.base_url = p2.base_url
      WHERE c2.canonical_id = freellm_upstream_providers.id
        AND p2.avg_latency_ms IS NOT NULL
    )),
    updated_at = updated_at
WHERE id IN (SELECT canonical_id FROM canonical_0025);

-- 12. Drop the losers (keys/models/configs already repointed).
DELETE FROM freellm_upstream_providers
WHERE id NOT IN (SELECT canonical_id FROM canonical_0025);

DROP TABLE IF EXISTS mp_survivors_0025;
DROP TABLE IF EXISTS canonical_0025;
