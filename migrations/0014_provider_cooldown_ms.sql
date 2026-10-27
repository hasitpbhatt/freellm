-- Per-provider retry cooldown: how long a config stays out of rotation after
-- a failure, before exponential backoff multiplies it. NULL means the global
-- default (30 minutes). Set longer for quotas that reset slowly (e.g. monthly
-- upstream credit pools) so a dead provider isn't hammered every 30 minutes.

ALTER TABLE freellm_model_providers ADD COLUMN cooldown_ms INTEGER
  CHECK (cooldown_ms IS NULL OR (cooldown_ms >= 0 AND cooldown_ms <= 604800000));
