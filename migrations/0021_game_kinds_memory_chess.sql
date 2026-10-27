-- Widen the game-rounds CHECK to include the memory and chess arcade games.
-- b60ed1e shipped the memory/chess server logic but left the CHECK from
-- 0018_game_kinds.sql at (reaction, typing, taps, clear), so every memory and
-- chess round insert threw a constraint violation and the endpoints 500'd.
--
-- freellm_game_rounds is a leaf table (nothing REFERENCES it), so the
-- rebuild-then-swap pattern is safe: no cascade can reach referencing rows.

-- 1. Rebuilt table with the widened CHECK.
CREATE TABLE freellm_game_rounds_new (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  claimed_at  INTEGER,                          -- NULL until claimed (one claim max)
  reaction_ms INTEGER,                          -- validated client timing
  reward      INTEGER NOT NULL DEFAULT 0,
  game        TEXT NOT NULL DEFAULT 'reaction'
    CHECK (game IN ('reaction', 'typing', 'taps', 'memory', 'chess', 'clear')),
  detail      TEXT
);

-- 2. Preserve every existing round (scores, claims, history).
INSERT INTO freellm_game_rounds_new (id, user_id, created_at, claimed_at, reaction_ms, reward, game, detail)
SELECT id, user_id, created_at, claimed_at, reaction_ms, reward, game, detail
FROM freellm_game_rounds;

-- 3. Swap tables atomically (drops the old index with the old table).
DROP TABLE freellm_game_rounds;
ALTER TABLE freellm_game_rounds_new RENAME TO freellm_game_rounds;

-- 4. Restore the index.
CREATE INDEX idx_freellm_game_rounds_user_time ON freellm_game_rounds(user_id, created_at DESC);
