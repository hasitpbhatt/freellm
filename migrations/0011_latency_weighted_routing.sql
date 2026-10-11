-- latency_weighted routing: allow the epsilon-greedy strategy.
--
-- SQLite has no ALTER CHECK, so the table is rebuilt with the wider
-- constraint. All columns added by 0002/0004/0005 are preserved.

PRAGMA foreign_keys = OFF;

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

PRAGMA foreign_keys = ON;
