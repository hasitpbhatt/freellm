-- Personal API tokens: Bearer auth for /v1 (the OpenAI-compatible surface).
-- Only the SHA-256 hash is stored; the raw fl_… token is shown once at
-- creation, exactly like session tokens (see lib/session.ts).

CREATE TABLE freellm_api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES freellm_users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  token_prefix TEXT NOT NULL,               -- display aid, e.g. "fl_9f3a…"
  token_hash   TEXT NOT NULL UNIQUE,        -- sha256(token) — never the token itself
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_freellm_api_tokens_user ON freellm_api_tokens(user_id, created_at DESC);
CREATE INDEX idx_freellm_api_tokens_hash ON freellm_api_tokens(token_hash);
