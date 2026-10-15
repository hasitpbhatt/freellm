-- BYOK OAuth accounts: a user may hold several personal credentials in the
-- vault ("Your Key" stays strictly per-user, never pooled). auth_kind marks
-- whether the stored secret is a static bearer (api_key) or a user-supplied
-- OAuth access token (oauth). OAuth refresh tokens are stored encrypted for
-- future rotation support and are NEVER revealable via any endpoint.
-- expires_at is unix epoch ms when the access token is known to expire (NULL
-- when unknown); the API refuses to dial an expired OAuth credential.

ALTER TABLE freellm_api_keys ADD COLUMN auth_kind TEXT NOT NULL DEFAULT 'api_key'
  CHECK (auth_kind IN ('api_key', 'oauth'));
ALTER TABLE freellm_api_keys ADD COLUMN refresh_ciphertext TEXT;
ALTER TABLE freellm_api_keys ADD COLUMN refresh_iv TEXT;
ALTER TABLE freellm_api_keys ADD COLUMN expires_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_freellm_api_keys_user_kind
  ON freellm_api_keys(user_id, auth_kind);
