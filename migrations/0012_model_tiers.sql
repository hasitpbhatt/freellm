-- Model access tiering: gate aliases (e.g. gpt-luna) behind a user tier.
--
--   freellm_models.access_tier — minimum tier required to use the alias
--   freellm_users.tier         — the caller's tier (admins bypass all gates)
--
-- Ranks: free < pro < enterprise. A caller may use an alias when their tier
-- rank >= the alias's tier rank. Enforcement is server-side in the chat,
-- OpenAI-compatible, and arena routes; catalogs expose access_tier so
-- clients can show locked state before attempting a call.

ALTER TABLE freellm_models ADD COLUMN access_tier TEXT NOT NULL DEFAULT 'free'
  CHECK (access_tier IN ('free', 'pro', 'enterprise'));

ALTER TABLE freellm_users ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'
  CHECK (tier IN ('free', 'pro', 'enterprise'));
