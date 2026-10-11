-- M5 arena: Elo ratings, battle attribution, persisted answers.

ALTER TABLE freellm_models ADD COLUMN elo_rating INTEGER NOT NULL DEFAULT 1500;
ALTER TABLE freellm_models ADD COLUMN elo_games INTEGER NOT NULL DEFAULT 0;
ALTER TABLE freellm_models ADD COLUMN elo_wins INTEGER NOT NULL DEFAULT 0;

-- battle answers: {"A": {"slug": "...", "content": "..."}, "B": {...}}
ALTER TABLE freellm_battles ADD COLUMN answers TEXT;

-- attribute pool spend to the battle that caused it
ALTER TABLE freellm_usage_events ADD COLUMN battle_id TEXT REFERENCES freellm_battles(id);

CREATE INDEX idx_freellm_usage_events_battle ON freellm_usage_events(battle_id);
CREATE INDEX idx_freellm_battles_status ON freellm_battles(status, created_at DESC);
