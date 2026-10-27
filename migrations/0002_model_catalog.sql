-- Model catalog: aliases (user-facing) grouped over upstream provider configs.
--
-- models           — the alias layer: what users pick in chat (e.g. "poolside-laguna")
-- model_providers  — N upstream configs behind each alias (base_url + upstream model + bearer).
--                    A request to an alias multiplexes across its active provider configs
--                    using the alias's routing strategy (round_robin | random | failover).

CREATE TABLE freellm_models (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,        -- alias used in API/UI, e.g. 'poolside-laguna'
  label             TEXT NOT NULL,
  description       TEXT,
  capabilities      TEXT NOT NULL DEFAULT '[]',  -- JSON array: ["coding","fast","long-context"]
  context_window    INTEGER,
  flat_rate_credits INTEGER NOT NULL DEFAULT 2000, -- charged when the provider omits usage
  routing           TEXT NOT NULL DEFAULT 'round_robin' CHECK (routing IN ('round_robin', 'random', 'failover')),
  active            INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX idx_freellm_models_active ON freellm_models(active, sort_order);

CREATE TABLE freellm_model_providers (
  id                   TEXT PRIMARY KEY,
  model_id             TEXT NOT NULL REFERENCES freellm_models(id) ON DELETE CASCADE,
  label                TEXT NOT NULL,             -- admin label, e.g. 'pool-key-1'
  base_url             TEXT NOT NULL,             -- OpenAI-compatible base, e.g. https://api.poolside.ai/v1
  upstream_model       TEXT NOT NULL,             -- model name sent upstream
  api_key_ciphertext   TEXT NOT NULL,             -- AES-256-GCM ciphertext (base64)
  api_key_iv           TEXT NOT NULL,             -- 12-byte IV (base64)
  status               TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('unknown', 'live', 'slow', 'down', 'disabled')),
  last_checked_at      INTEGER,
  last_error           TEXT,
  avg_latency_ms       INTEGER,                   -- EWMA, used by least-loaded style routing
  priority             INTEGER NOT NULL DEFAULT 0, -- failover order (lower first)
  active               INTEGER NOT NULL DEFAULT 1, -- admin kill-switch for one config
  messages_served      INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX idx_freellm_model_providers_alias ON freellm_model_providers(model_id, active, priority);
