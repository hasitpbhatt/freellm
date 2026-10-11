-- Arcade levels: one row per claimed level-up (user_id, level). XP itself is
-- derived from lifetime game_reward ledger sums, so no counter can drift.

CREATE TABLE freellm_arcade_levels (
  user_id    TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  level      INTEGER NOT NULL CHECK (level >= 2),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, level)
);
