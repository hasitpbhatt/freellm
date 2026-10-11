-- Track user visits to GitHub repository for star verification tasks.
-- Stores when users access the URL they need to star to complete the GitHub star task.

CREATE TABLE freellm_user_visits (
  user_id    TEXT NOT NULL,
  url        TEXT NOT NULL,
  visited_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, url)
);

-- Index for quick lookup of recent visits.
CREATE INDEX idx_freellm_user_visits_recent ON freellm_user_visits(user_id, visited_at DESC);