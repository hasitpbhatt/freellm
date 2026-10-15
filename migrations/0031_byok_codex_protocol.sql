-- Codex BYOK accounts: a vault row can now speak the OpenAI Responses
-- protocol (ChatGPT Codex backend) instead of Chat Completions. `protocol`
-- selects the wire format; `account_id` carries the optional
-- ChatGPT-Account-ID binding header so several personal Codex accounts in
-- one vault never cross-bind to the wrong OpenAI account. Both columns are
-- metadata only — secrets stay in the encrypted key/refresh columns.

ALTER TABLE freellm_api_keys ADD COLUMN protocol TEXT NOT NULL DEFAULT 'openai'
  CHECK (protocol IN ('openai', 'codex'));
ALTER TABLE freellm_api_keys ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_freellm_api_keys_user_protocol
  ON freellm_api_keys(user_id, protocol);
