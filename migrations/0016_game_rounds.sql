-- Reaction-sprint earning game: server-issued rounds claimed once.
-- Credits are bounded on both axes: per-user daily paid plays and a global
-- daily budget, so the game can never mint unbounded tokens.

CREATE TABLE freellm_game_rounds (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  claimed_at  INTEGER,                          -- NULL until claimed (one claim max)
  reaction_ms INTEGER,                          -- validated client timing
  reward      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_freellm_game_rounds_user_time ON freellm_game_rounds(user_id, created_at DESC);
