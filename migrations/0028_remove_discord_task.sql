-- Remove the Discord task from earnings. The community surface is X + GitHub
-- only; a Discord join/verify task must not appear on /earn or pay out.
--
-- Matches by slug, title, or URL so prod rows seeded under any variant
-- ('join_discord', 'discord_join', 'discord', ...) are all caught.
-- Completions are deleted FIRST (unlike 0023, which deleted the tasks first
-- and left its completion cleanup matching nothing).

DELETE FROM freellm_task_completions WHERE task_id IN (
  SELECT id FROM freellm_tasks
  WHERE lower(slug) LIKE '%discord%'
     OR lower(title) LIKE '%discord%'
     OR lower(url) LIKE '%discord%'
);

DELETE FROM freellm_tasks
WHERE lower(slug) LIKE '%discord%'
   OR lower(title) LIKE '%discord%'
   OR lower(url) LIKE '%discord%';
