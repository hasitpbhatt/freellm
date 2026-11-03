-- Seasonal events infrastructure
-- Events are time-limited with special rewards, quests, and cosmetics

CREATE TABLE IF NOT EXISTS freellm_seasonal_events (
    id TEXT PRIMARY KEY,              -- event slug (e.g., "halloween_2024", "new_year_2025")
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,               -- emoji
    banner_color TEXT NOT NULL,       -- CSS gradient or color
    start_at INTEGER NOT NULL,        -- Unix timestamp (ms)
    end_at INTEGER NOT NULL,          -- Unix timestamp (ms)
    config_json TEXT NOT NULL,        -- JSON: quests, rewards, multipliers, cosmetics
    active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_freellm_seasonal_events_active ON freellm_seasonal_events(active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_freellm_seasonal_events_time ON freellm_seasonal_events(start_at, end_at);

-- User participation in seasonal events
CREATE TABLE IF NOT EXISTS freellm_user_seasonal_events (
    user_id TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES freellm_seasonal_events(id) ON DELETE CASCADE,
    progress_json TEXT NOT NULL DEFAULT '{}',  -- per-quest progress
    rewards_claimed_json TEXT NOT NULL DEFAULT '[]', -- claimed reward IDs
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_freellm_user_seasonal_events_user ON freellm_user_seasonal_events(user_id);
CREATE INDEX IF NOT EXISTS idx_freellm_user_seasonal_events_event ON freellm_user_seasonal_events(event_id);

-- Seasonal cosmetics (frames, badges, titles)
CREATE TABLE IF NOT EXISTS freellm_seasonal_cosmetics (
    id TEXT PRIMARY KEY,              -- cosmetic ID
    event_id TEXT NOT NULL REFERENCES freellm_seasonal_events(id) ON DELETE CASCADE,
    type TEXT NOT NULL,               -- 'frame', 'title', 'badge'
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    unlock_criteria_json TEXT NOT NULL, -- JSON: how to unlock
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_freellm_seasonal_cosmetics_event ON freellm_seasonal_cosmetics(event_id);

-- User unlocked cosmetics
CREATE TABLE IF NOT EXISTS freellm_user_cosmetics (
    user_id TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
    cosmetic_id TEXT NOT NULL REFERENCES freellm_seasonal_cosmetics(id) ON DELETE CASCADE,
    unlocked_at INTEGER NOT NULL,
    equipped INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, cosmetic_id)
);

CREATE INDEX IF NOT EXISTS idx_freellm_user_cosmetics_user ON freellm_user_cosmetics(user_id);
CREATE INDEX IF NOT EXISTS idx_freellm_user_cosmetics_equipped ON freellm_user_cosmetics(equipped) WHERE equipped = 1;