-- Key health event log: append-only record of BYOK key test results and chat failures
-- Allows admins to identify dead/flaky keys and users to see their key reliability

CREATE TABLE IF NOT EXISTS freellm_key_health_events (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES freellm_connections(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('test_success', 'test_failure', 'chat_success', 'chat_failure', 'oauth_refresh_success', 'oauth_refresh_failure')),
  error_code TEXT,
  error_message TEXT,
  latency_ms INTEGER,
  request_model TEXT,
  request_tokens INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_key_health_connection ON freellm_key_health_events(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_key_health_user ON freellm_key_health_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_key_health_type ON freellm_key_health_events(event_type, created_at DESC);