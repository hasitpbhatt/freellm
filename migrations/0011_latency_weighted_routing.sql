-- latency_weighted routing: allow the epsilon-greedy strategy.
--
-- SQLite has no ALTER CHECK, so freellm_models is rebuilt with the wider
-- constraint. DANGER that bit us in production (Oct 2026): DROP TABLE on the
-- parent fires the child's ON DELETE CASCADE (D1 enforces FKs even with
-- PRAGMA foreign_keys=OFF, which does not persist across D1's statement
-- boundary) and silently deletes every provider config. So: back up the
-- child table first, drop it, rebuild the parent, then restore the child.
-- Never DROP freellm_models while freellm_model_providers exists.

-- 1. Back up provider configs (column order preserved by SELECT *).
CREATE TABLE _providers_backup AS SELECT * FROM freellm_model_providers;

-- 2. Drop the child so no CASCADE can fire.
DROP TABLE freellm_model_providers;

-- 3. Rebuild the parent with the wider routing CHECK. All columns added by
-- 0002/0004/0005 are preserved, keyed by identical ids.
CREATE TABLE freellm_models_new (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  description       TEXT,
  capabilities      TEXT NOT NULL DEFAULT '[]',
  context_window    INTEGER,
  flat_rate_credits INTEGER NOT NULL DEFAULT 2000,
  routing           TEXT NOT NULL DEFAULT 'round_robin' CHECK (routing IN ('round_robin', 'random', 'failover', 'latency_weighted')),
  active            INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  max_output_tokens INTEGER NOT NULL DEFAULT 4096,
  elo_rating        INTEGER NOT NULL DEFAULT 1500,
  elo_games         INTEGER NOT NULL DEFAULT 0,
  elo_wins          INTEGER NOT NULL DEFAULT 0
);

INSERT INTO freellm_models_new (id, slug, label, description, capabilities, context_window, flat_rate_credits, routing, active, sort_order, created_at, updated_at, max_output_tokens, elo_rating, elo_games, elo_wins)
  SELECT id, slug, label, description, capabilities, context_window, flat_rate_credits, routing, active, sort_order, created_at, updated_at, max_output_tokens, elo_rating, elo_games, elo_wins
  FROM freellm_models;

DROP TABLE freellm_models;

ALTER TABLE freellm_models_new RENAME TO freellm_models;

CREATE INDEX idx_freellm_models_active ON freellm_models(active, sort_order);

-- 4. Recreate the child schema EXACTLY (0002 columns + 0010's cooldown_until
-- appended last, matching the backup's SELECT * order), then restore.
CREATE TABLE freellm_model_providers (
  id                   TEXT PRIMARY KEY,
  model_id             TEXT NOT NULL REFERENCES freellm_models(id) ON DELETE CASCADE,
  label                TEXT NOT NULL,
  base_url             TEXT NOT NULL,
  upstream_model       TEXT NOT NULL,
  api_key_ciphertext   TEXT NOT NULL,
  api_key_iv           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'live', 'slow', 'down', 'disabled')),
  last_checked_at      INTEGER,
  last_error           TEXT,
  avg_latency_ms       INTEGER,
  priority             INTEGER NOT NULL DEFAULT 0,
  active               INTEGER NOT NULL DEFAULT 1,
  messages_served      INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  cooldown_until       INTEGER
);
CREATE INDEX idx_freellm_model_providers_alias ON freellm_model_providers(model_id, active, priority);

INSERT INTO freellm_model_providers SELECT * FROM _providers_backup;

DROP TABLE _providers_backup;
