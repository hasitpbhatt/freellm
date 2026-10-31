-- Model-level request and token distribution tracking.
--
-- Lightweight per-model aggregates: request count, input/output/total tokens.
-- Updated atomically in the same transaction as usage event settlement.
-- No new tables; just four columns on the existing freellm_models table.
-- KISS: minimal overhead, no joins needed for admin dashboards.

ALTER TABLE freellm_models ADD COLUMN total_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE freellm_models ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE freellm_models ADD COLUMN total_output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE freellm_models ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;

-- Index for quick "top models by tokens" queries (optional, small table).
CREATE INDEX idx_freellm_models_total_tokens ON freellm_models(total_tokens DESC);
