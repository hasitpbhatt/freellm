-- Leaderboards
-- Materialized views refreshed periodically (or on-demand) for performance

-- Typing WPM leaderboard (best WPM per user this week)
CREATE TABLE IF NOT EXISTS freellm_leaderboard_typing (
    user_id TEXT PRIMARY KEY REFERENCES freellm_users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    avatar_url TEXT,
    best_wpm INTEGER NOT NULL,
    achieved_at INTEGER NOT NULL,
    week_start INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_freellm_leaderboard_typing_week ON freellm_leaderboard_typing(week_start, best_wpm DESC);

-- Memory moves leaderboard (fewest moves per user this week)
CREATE TABLE IF NOT EXISTS freellm_leaderboard_memory (
    user_id TEXT PRIMARY KEY REFERENCES freellm_users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    avatar_url TEXT,
    best_moves INTEGER NOT NULL,
    achieved_at INTEGER NOT NULL,
    week_start INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_freellm_leaderboard_memory_week ON freellm_leaderboard_memory(week_start, best_moves ASC);

-- Streak leaderboard (current streak)
CREATE TABLE IF NOT EXISTS freellm_leaderboard_streak (
    user_id TEXT PRIMARY KEY REFERENCES freellm_users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    avatar_url TEXT,
    streak INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_freellm_leaderboard_streak ON freellm_leaderboard_streak(streak DESC);

-- Referral leaderboard (lifetime qualified referrals)
CREATE TABLE IF NOT EXISTS freellm_leaderboard_referrals (
    user_id TEXT PRIMARY KEY REFERENCES freellm_users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    avatar_url TEXT,
    qualified_count INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_freellm_leaderboard_referrals ON freellm_leaderboard_referrals(qualified_count DESC);

-- Leaderboard metadata (last refresh time)
CREATE TABLE IF NOT EXISTS freellm_leaderboard_meta (
    leaderboard_id TEXT PRIMARY KEY, -- 'typing', 'memory', 'streak', 'referrals'
    last_refresh INTEGER NOT NULL
);