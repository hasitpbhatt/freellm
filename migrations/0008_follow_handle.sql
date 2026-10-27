-- Repoint the follow task at the operator's real X handle. The previous
-- target (@freellm) does not exist — the link just 404'd for users.
-- Updated in place (same slug) so existing completion records survive.

UPDATE freellm_tasks
SET title       = 'Follow @Hasit_P_Bhatt on X',
    description = 'Model launches, Pool status, and build-in-public updates.',
    url         = 'https://x.com/HasIt_P_Bhatt'
WHERE slug = 'follow_x';
