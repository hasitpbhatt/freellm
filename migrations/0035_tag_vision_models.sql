-- Mark the vision-language upstream model so image requests can be routed
-- only to configs that actually accept them, and so the public catalog can
-- report the capability. Idempotent: leaves existing valid capability lists
-- intact.
--
-- Careful: the alias slug is `nemotron-3-5-super-vl`, but the upstream model
-- name includes the provider prefix and free-tier suffix. Filtering on the
-- alias slug would update zero rows.
--
-- Preflight (a human must run this read-only query before applying):
--   SELECT upstream_provider_id, upstream_model, capabilities
--   FROM freellm_upstream_models
--   WHERE upstream_model = 'nvidia/nemotron-3.5-super-vl:free';

UPDATE freellm_upstream_models
SET capabilities = CASE
  WHEN capabilities IS NULL OR capabilities = '' THEN '["vision"]'
  WHEN json_valid(capabilities)
       AND EXISTS (SELECT 1 FROM json_each(capabilities) WHERE value = 'vision') THEN capabilities
  WHEN json_valid(capabilities) AND json_type(capabilities) = 'array'
       THEN json_insert(capabilities, '$[#]', 'vision')
  ELSE '["vision"]'
END
WHERE upstream_model = 'nvidia/nemotron-3.5-super-vl:free';

-- Postflight: this must return a row whose capabilities contain "vision".
--   SELECT upstream_model, capabilities FROM freellm_upstream_models
--   WHERE upstream_model = 'nvidia/nemotron-3.5-super-vl:free';
