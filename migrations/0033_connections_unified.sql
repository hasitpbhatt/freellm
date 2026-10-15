-- Unified connections: ONE table for every personal/shared credential, so
-- static API keys and OAuth grants stop living in two places.
--
--   scope='personal'  owner_id = user id   -> the user's own vault entries
--   scope='shared'    owner_id = NULL      -> admin-managed service accounts
--
-- freellm_api_keys is backfilled here and left in place (unused) as a
-- rollback safety net; a later migration drops it.

CREATE TABLE IF NOT EXISTS freellm_connections (
  id                       TEXT PRIMARY KEY,
  owner_id                 TEXT,                 -- user id for personal, NULL for shared
  scope                    TEXT NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal','shared')),
  provider                 TEXT NOT NULL,        -- 'kilo','codex','google','grok','qoder','antigravity','byok'
  label                    TEXT NOT NULL,
  base_url                 TEXT NOT NULL DEFAULT '',
  upstream_model           TEXT NOT NULL DEFAULT '',
  key_ciphertext           TEXT NOT NULL,        -- static bearer, or the OAuth access token
  key_iv                   TEXT NOT NULL,
  auth_kind                TEXT NOT NULL DEFAULT 'api_key' CHECK (auth_kind IN ('api_key','oauth')),
  protocol                 TEXT NOT NULL DEFAULT 'openai' CHECK (protocol IN ('openai','codex')),
  account_id               TEXT,
  refresh_ciphertext       TEXT,
  refresh_iv               TEXT,
  expires_at               INTEGER,
  status                   TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at          INTEGER,
  last_error               TEXT,
  avg_latency_ms           INTEGER,
  active                   INTEGER NOT NULL DEFAULT 1,
  messages_served          INTEGER NOT NULL DEFAULT 0,
  contributed              INTEGER NOT NULL DEFAULT 0,
  contribution_reward_paid INTEGER NOT NULL DEFAULT 0,
  last_alive_at            INTEGER,
  extra_headers_json       TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_connections_owner   ON freellm_connections(owner_id, scope);
CREATE INDEX IF NOT EXISTS idx_connections_scope   ON freellm_connections(scope);
CREATE INDEX IF NOT EXISTS idx_connections_enabled ON freellm_connections(active);

-- Backfill every legacy vault row as a personal connection.
INSERT INTO freellm_connections (
  id, owner_id, scope, provider, label, base_url, upstream_model,
  key_ciphertext, key_iv, auth_kind, protocol, account_id,
  refresh_ciphertext, refresh_iv, expires_at,
  status, last_checked_at, last_error, avg_latency_ms, active, messages_served,
  contributed, contribution_reward_paid, last_alive_at,
  created_at, updated_at
)
SELECT
  id, user_id, 'personal', provider, label, base_url, upstream_model,
  key_ciphertext, key_iv, COALESCE(auth_kind, 'api_key'), COALESCE(protocol, 'openai'), account_id,
  refresh_ciphertext, refresh_iv, expires_at,
  status, last_checked_at, last_error, avg_latency_ms, active, messages_served,
  contributed, contribution_reward_paid, last_alive_at,
  created_at, updated_at
FROM freellm_api_keys
WHERE id NOT IN (SELECT id FROM freellm_connections);

-- OAuth rows were all stamped provider='byok'. Recover the real provider id
-- from the endpoint/label so the UI can badge them (mirrors
-- providerIdForVaultRow in lib/oauth.ts).
UPDATE freellm_connections SET provider = 'codex'
  WHERE auth_kind = 'oauth' AND provider = 'byok'
    AND (base_url LIKE '%chatgpt.com%' OR label LIKE '%Codex%');
UPDATE freellm_connections SET provider = 'kilo'
  WHERE auth_kind = 'oauth' AND provider = 'byok' AND base_url LIKE '%kilo.ai%';
UPDATE freellm_connections SET provider = 'qoder'
  WHERE auth_kind = 'oauth' AND provider = 'byok' AND (base_url LIKE '%qoder%' OR label LIKE '%Qoder%');
-- Antigravity before Google: its endpoint (daily-cloudcode-pa.googleapis.com)
-- is also hosted on googleapis.com, so a broad '%googleapis.com%' match would
-- claim it first and the `provider = 'byok'` guard would never revisit it.
UPDATE freellm_connections SET provider = 'antigravity'
  WHERE auth_kind = 'oauth' AND provider = 'byok'
    AND (base_url LIKE '%cloudcode-pa%' OR base_url LIKE '%antigravity%' OR label LIKE '%Antigravity%');
UPDATE freellm_connections SET provider = 'google'
  WHERE auth_kind = 'oauth' AND provider = 'byok'
    AND (base_url LIKE '%generativelanguage.googleapis.com%' OR label LIKE '%Google%' OR label LIKE '%Gemini%');
UPDATE freellm_connections SET provider = 'grok'
  WHERE auth_kind = 'oauth' AND provider = 'byok' AND (base_url LIKE '%x.ai%' OR label LIKE '%Grok%');

-- Bind an API token to a connection: when set, /v1 dials that connection with
-- the request's model as the upstream model — no key_mode/key_id needed.
ALTER TABLE freellm_api_tokens ADD COLUMN connection_id TEXT;
CREATE INDEX IF NOT EXISTS idx_freellm_api_tokens_connection ON freellm_api_tokens(connection_id);
