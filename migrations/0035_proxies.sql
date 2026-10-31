-- Proxy pool for outbound retries on 429/blocked connections.
-- Proxies are global and only used on failure (direct-first). Inert if empty.
CREATE TABLE freellm_proxies (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  username TEXT,
  password_ciphertext TEXT,
  password_iv TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  cooldown_until INTEGER,
  last_checked_at INTEGER,
  last_error TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_freellm_proxies_enabled ON freellm_proxies(enabled, status);
CREATE INDEX idx_freellm_proxies_cooldown ON freellm_proxies(cooldown_until);
