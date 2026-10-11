-- Replace the placeholder "Star freellm on GitHub" task (star_gh) with the
-- CodeWhip star. Updated in place so users who already claimed the old task
-- keep their completion record — the reward bump applies to unclaimed users.
UPDATE freellm_tasks
SET title       = 'Star CodeWhip on GitHub',
    description = 'CodeWhip — the open, policy-checked terminal coding agent. Star it, then point it at The Pool.',
    url         = 'https://github.com/hasitpbhatt/codewhip',
    reward      = 1000000
WHERE slug = 'star_gh';
