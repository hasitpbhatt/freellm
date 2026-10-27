-- Add streaming support flag to upstream models.
-- Some providers/models don't support SSE streaming; this flag lets the
-- router fall back to non-streaming (regular JSON) when needed.

ALTER TABLE freellm_upstream_models ADD COLUMN supports_streaming INTEGER NOT NULL DEFAULT 1;

-- Index for fast filtering during candidate resolution.
CREATE INDEX IF NOT EXISTS idx_freellm_upstream_models_streaming
  ON freellm_upstream_models(upstream_provider_id, supports_streaming);