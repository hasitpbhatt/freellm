-- Remove non-codewhip tasks. Only the CodeWhip star task remains.
-- The follow_x and play-games tasks are removed as requested.

DELETE FROM freellm_tasks WHERE slug IN ('follow_x', 'play-games');

-- Also clean up any completions for those tasks (optional, but clean)
DELETE FROM freellm_task_completions WHERE task_id IN (
  SELECT id FROM freellm_tasks WHERE slug IN ('follow_x', 'play-games')
);