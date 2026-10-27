-- SkillArcade cross-earn: playing games on games.hasit.in earns freellm
-- credits. V1 is trust-based like every other task (play, come back,
-- Confirm); a server-verified variant can replace the claim path later
-- without touching this seed.

INSERT INTO freellm_tasks (id, slug, title, description, reward, url, sort_order, active, created_at)
VALUES (
  'task_play_games',
  'play-games',
  'Play SkillArcade',
  'Play a game on SkillArcade (games.hasit.in), then Confirm here to claim free Pool credits.',
  25000,
  'https://games.hasit.in',
  4,
  1,
  unixepoch() * 1000
);
