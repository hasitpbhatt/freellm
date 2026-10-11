-- M6 BYOK vault: store each key's direct OpenAI-compatible endpoint config.
--
-- 0001 created the original contribution-vault shape. The chat/key routes now
-- expect endpoint fields, so bring upgraded databases to the same shape while
-- preserving existing rows. Legacy rows without an endpoint/model are marked
-- inactive because they cannot be used for direct chat.

ALTER TABLE freellm_api_keys ADD COLUMN base_url TEXT NOT NULL DEFAULT '';
ALTER TABLE freellm_api_keys ADD COLUMN upstream_model TEXT NOT NULL DEFAULT '';
ALTER TABLE freellm_api_keys ADD COLUMN status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE freellm_api_keys ADD COLUMN last_checked_at INTEGER;
ALTER TABLE freellm_api_keys ADD COLUMN avg_latency_ms INTEGER;
ALTER TABLE freellm_api_keys ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE freellm_api_keys ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

UPDATE freellm_api_keys SET updated_at = created_at WHERE updated_at = 0;
UPDATE freellm_api_keys
SET active = 0
WHERE base_url = '' OR upstream_model = '';
