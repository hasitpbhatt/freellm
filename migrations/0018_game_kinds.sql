-- Arcade expansion: rounds carry which game they belong to plus an opaque
-- detail payload (typing phrase), so new games reuse one table and one
-- claim path instead of per-game tables.

ALTER TABLE freellm_game_rounds ADD COLUMN game TEXT NOT NULL DEFAULT 'reaction'
  CHECK (game IN ('reaction', 'typing', 'taps', 'clear'));
ALTER TABLE freellm_game_rounds ADD COLUMN detail TEXT;
