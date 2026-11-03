-- Streak freeze mechanism
-- Allows users to preserve their streak if they miss a day
-- Earned: 1 freeze at day 30 chest, or purchasable with 50k arcade XP

CREATE TABLE IF NOT EXISTS freellm_streak_freezes (
    id TEXT PRIMARY KEY,           -- "streak_freeze:{user_id}:{earned_at}"
    user_id TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
    earned_at INTEGER NOT NULL,    -- when the freeze was earned
    earned_source TEXT NOT NULL,   -- 'day30_chest', 'xp_purchase', 'admin'
    used_at INTEGER,               -- when the freeze was consumed
    used_for_date TEXT,            -- the checkin_date that was saved
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_freellm_streak_freezes_user ON freellm_streak_freezes(user_id);
CREATE INDEX IF NOT EXISTS idx_freellm_streak_freezes_used ON freellm_streak_freezes(used_at) WHERE used_at IS NOT NULL;