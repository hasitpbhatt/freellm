-- Scoped-only payment rule: when set on an alias, requests to it can only
-- spend that alias's scoped grant balance (promo/grant credits), never the
-- user's global balance. This protects scarce provider capacity (e.g. luna):
-- callers without luna tokens cannot burn luna pool quota.

ALTER TABLE freellm_models ADD COLUMN scoped_only INTEGER NOT NULL DEFAULT 0
  CHECK (scoped_only IN (0, 1));
