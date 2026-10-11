-- Provider failover cooldown: keep a recently failed config out of candidate
-- selection for 30 minutes. NULL means the config is eligible now.

ALTER TABLE freellm_model_providers ADD COLUMN cooldown_until INTEGER;
