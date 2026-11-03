-- Weekly rotating quests
-- Quests rotate weekly (Monday 00:00 UTC) and are available for completion during that week
-- Types: typing_wpm, memory_moves, checkin_streak, referral_signups, pool_tokens_used

CREATE TABLE IF NOT EXISTS freellm_weekly_quests (
    id TEXT PRIMARY KEY,              -- "weekly_quest:{year}:{week_number}:{slug}"
    week_start INTEGER NOT NULL,      -- Monday 00:00 UTC timestamp for this week
    week_end INTEGER NOT NULL,        -- Next Monday 00:00 UTC
    slug TEXT NOT NULL,               -- e.g., "typing_80wpm", "memory_perfect", "streak_7", "referral_1", "pool_50k"
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    target_value INTEGER NOT NULL,    -- target to achieve (e.g., 80 WPM, 1 referral, 50000 tokens)
    reward INTEGER NOT NULL,          -- credit reward
    quest_type TEXT NOT NULL,         -- 'typing_wpm', 'memory_moves', 'checkin_streak', 'referral_signups', 'pool_tokens_used'
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_freellm_weekly_quests_week ON freellm_weekly_quests(week_start);
CREATE INDEX IF NOT EXISTS idx_freellm_weekly_quests_active ON freellm_weekly_quests(active) WHERE active = 1;

-- User progress on weekly quests
CREATE TABLE IF NOT EXISTS freellm_weekly_quest_progress (
    user_id TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
    quest_id TEXT NOT NULL REFERENCES freellm_weekly_quests(id) ON DELETE CASCADE,
    current_value INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    claimed_at INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_freellm_weekly_quest_progress_user ON freellm_weekly_quest_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_freellm_weekly_quest_progress_completed ON freellm_weekly_quest_progress(completed) WHERE completed = 1;