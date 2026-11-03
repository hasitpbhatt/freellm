-- Badge system
-- 12 badges: streak_7, streak_30, typing_80wpm, typing_100wpm, memory_perfect, memory_speed, referral_1, referral_5, referral_10, pool_100k, pool_1m, daily_clear

CREATE TABLE IF NOT EXISTS freellm_badges (
    id TEXT PRIMARY KEY,              -- badge slug
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,               -- emoji or icon name
    category TEXT NOT NULL,           -- 'streak', 'typing', 'memory', 'referral', 'pool', 'general'
    tier INTEGER NOT NULL DEFAULT 1,  -- 1, 2, 3 for progression
    reward INTEGER NOT NULL DEFAULT 0, -- one-time credit reward for earning
    created_at INTEGER NOT NULL
);

-- User badge awards
CREATE TABLE IF NOT EXISTS freellm_user_badges (
    user_id TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
    badge_id TEXT NOT NULL REFERENCES freellm_badges(id) ON DELETE CASCADE,
    earned_at INTEGER NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0, -- whether the user has seen the notification
    PRIMARY KEY (user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_freellm_user_badges_user ON freellm_user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_freellm_user_badges_notified ON freellm_user_badges(notified) WHERE notified = 0;

-- Insert badge definitions
INSERT OR IGNORE INTO freellm_badges (id, name, description, icon, category, tier, reward, created_at) VALUES
-- Streak badges
('streak_7', 'Week Streak', 'Maintain a 7-day check-in streak', '🔥', 'streak', 1, 50000, 0),
('streak_30', 'Month Streak', 'Maintain a 30-day check-in streak', '🏆', 'streak', 2, 200000, 0),
-- Typing badges
('typing_80wpm', 'Speed Demon', 'Achieve 80 WPM in a Typing game', '⌨️', 'typing', 1, 75000, 0),
('typing_100wpm', 'Typing Master', 'Achieve 100 WPM in a Typing game', '⚡', 'typing', 2, 150000, 0),
-- Memory badges
('memory_perfect', 'Perfect Memory', 'Complete Memory game in 6 moves (perfect)', '🧠', 'memory', 1, 75000, 0),
('memory_speed', 'Memory Sprint', 'Complete Memory game in under 30 seconds', '🏃', 'memory', 2, 100000, 0),
-- Referral badges
('referral_1', 'Connector', 'Refer 1 qualified friend', '🤝', 'referral', 1, 50000, 0),
('referral_5', 'Networker', 'Refer 5 qualified friends', '🌐', 'referral', 2, 150000, 0),
('referral_10', 'Influencer', 'Refer 10 qualified friends', '👑', 'referral', 3, 300000, 0),
-- Pool usage badges
('pool_100k', 'Pool Dipper', 'Use 100,000 Pool tokens total', '💧', 'pool', 1, 50000, 0),
('pool_1m', 'Pool Shark', 'Use 1,000,000 Pool tokens total', '🦈', 'pool', 2, 200000, 0),
-- General badges
('daily_clear', 'Daily Clear', 'Complete all daily activities (check-in + both games) 10 times', '✨', 'general', 1, 100000, 0);