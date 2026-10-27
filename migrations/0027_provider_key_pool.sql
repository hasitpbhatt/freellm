-- Finish the upstream key-pool refactor (begun in 0025).
--
-- freellm_upstream_keys is now the single source of truth for a provider's
-- bearer keys: one upstream provider (one base_url) owns N keys, each with its
-- own health, so an exhausted key cools down without taking the whole endpoint
-- out of rotation. 0025 created and backfilled the pool but left the legacy
-- single-key columns in place "until the new code soaked" — the new code now
-- reads the pool, so the duplicate columns are dropped here. This is what
-- finally removes the two-sources-of-truth fork.
--
-- Safety notes:
--   * ALTER TABLE ... DROP COLUMN does NOT fire a child's ON DELETE CASCADE
--     (that was the 0011 incident); dropping a plain, non-FK column on a
--     parent is safe. SQLite supports DROP COLUMN since 3.35, well below D1's
--     bundled version.
--   * A provider created between 0025 and this migration by the old
--     single-key code has key columns but no pool row — backfill it first so
--     no key is lost when the columns go away.

-- 1. Per-key error message (parity with the provider-level last_error).
ALTER TABLE freellm_upstream_keys ADD COLUMN last_error TEXT;

-- 2. Backfill a pool row for any provider missing one, preserving its key.
INSERT INTO freellm_upstream_keys (
  id, upstream_provider_id, label, api_key_ciphertext, api_key_iv,
  status, consecutive_failures, cooldown_until, priority, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))),
  id,
  'default',
  api_key_ciphertext,
  api_key_iv,
  status,
  consecutive_failures,
  cooldown_until,
  0,
  created_at,
  updated_at
FROM freellm_upstream_providers
WHERE id NOT IN (SELECT upstream_provider_id FROM freellm_upstream_keys);

-- 3. Drop the legacy single-key columns — the pool is authoritative now.
ALTER TABLE freellm_upstream_providers DROP COLUMN api_key_ciphertext;
ALTER TABLE freellm_upstream_providers DROP COLUMN api_key_iv;
