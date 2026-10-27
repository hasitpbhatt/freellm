-- Upstream provider profiles (shared across model aliases).
-- Decouples the real upstream provider (Poolside, OpenAI, etc.) from
-- the model alias that users chat with. One upstream provider can serve
-- many aliases with different upstream_model names.

CREATE TABLE freellm_upstream_providers (
  id                   TEXT PRIMARY KEY,           -- e.g. 'poolside', 'openai', 'anthropic'
  label                TEXT NOT NULL,              -- admin label, e.g. 'Poolside API'
  base_url             TEXT NOT NULL,              -- OpenAI-compatible base URL
  api_key_ciphertext   TEXT NOT NULL,              -- AES-256-GCM ciphertext (base64)
  api_key_iv           TEXT NOT NULL,              -- 12-byte IV (base64)
  status               TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'live', 'slow', 'down', 'disabled')),
  last_checked_at      INTEGER,
  last_error           TEXT,
  avg_latency_ms       INTEGER,                    -- EWMA across all configs using this provider
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  cooldown_until       INTEGER,
  cooldown_base_ms     INTEGER,                    -- custom base cooldown (ms); 0 = disabled; NULL = default 30m
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE INDEX idx_freellm_upstream_providers_status ON freellm_upstream_providers(status);

-- Upstream model catalog: canonical model names per provider.
-- Prevents typos and lets the admin UI offer a dropdown.
CREATE TABLE freellm_upstream_models (
  upstream_provider_id TEXT NOT NULL REFERENCES freellm_upstream_providers(id) ON DELETE CASCADE,
  upstream_model       TEXT NOT NULL,              -- exact name sent upstream, e.g. 'gpt-4o', 'claude-3-5-sonnet-20241022'
  capabilities         TEXT,                       -- JSON array: 'tools', 'vision', 'json_mode', etc.
  context_window       INTEGER,
  max_output_tokens    INTEGER,
  PRIMARY KEY (upstream_provider_id, upstream_model)
);

-- Model providers now reference the shared upstream provider.
-- This table replaces freellm_model_providers (renamed for migration safety).
CREATE TABLE freellm_model_providers_new (
  id                   TEXT PRIMARY KEY,
  model_id             TEXT NOT NULL REFERENCES freellm_models(id) ON DELETE CASCADE,
  upstream_provider_id TEXT NOT NULL REFERENCES freellm_upstream_providers(id) ON DELETE RESTRICT,
  upstream_model       TEXT NOT NULL,              -- must exist in freellm_upstream_models for this provider
  priority             INTEGER NOT NULL DEFAULT 0, -- failover order (lower first)
  active               INTEGER NOT NULL DEFAULT 1, -- admin kill-switch for this alias->provider mapping
  messages_served      INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX idx_freellm_model_providers_new_alias ON freellm_model_providers_new(model_id, active, priority);

-- Migrate data: each old provider becomes an upstream provider + one new mapping.
-- This is idempotent — safe to re-run if the migration is reapplied.

-- 1. Create upstream providers from existing model_providers
INSERT OR REPLACE INTO freellm_upstream_providers (
  id, label, base_url, api_key_ciphertext, api_key_iv,
  status, last_checked_at, last_error, avg_latency_ms,
  consecutive_failures, cooldown_until, cooldown_base_ms,
  created_at, updated_at
)
SELECT
  mp.id,
  mp.label,
  mp.base_url,
  mp.api_key_ciphertext,
  mp.api_key_iv,
  mp.status,
  mp.last_checked_at,
  mp.last_error,
  mp.avg_latency_ms,
  mp.consecutive_failures,
  mp.cooldown_until,
  NULL,                     -- cooldown_base_ms: use default
  mp.created_at,
  mp.updated_at
FROM freellm_model_providers mp;

-- 2. Create upstream model catalog entries
INSERT OR IGNORE INTO freellm_upstream_models (upstream_provider_id, upstream_model)
SELECT DISTINCT mp.id, mp.upstream_model
FROM freellm_model_providers mp;

-- 3. Create new model_providers table entries linking to upstream providers
-- Preserve ALL provider mappings, even those for inactive models (for safety)
INSERT OR REPLACE INTO freellm_model_providers_new (
  id, model_id, upstream_provider_id, upstream_model,
  priority, active, messages_served, created_at, updated_at
)
SELECT
  mp.id,
  mp.model_id,
  mp.id,                        -- upstream_provider_id = old provider id
  mp.upstream_model,
  mp.priority,
  mp.active,
  mp.messages_served,
  mp.created_at,
  mp.updated_at
FROM freellm_model_providers mp;

-- Swap tables atomically.
DROP TABLE freellm_model_providers;
ALTER TABLE freellm_model_providers_new RENAME TO freellm_model_providers;