-- Admin-managed email blocklist: one JS RegExp per row, tested against the
-- normalized (lowercased) email at Google-OAuth callback time. A match
-- rejects the sign-in before any account is created or session issued.

CREATE TABLE freellm_email_blocks (
  id         TEXT PRIMARY KEY,
  pattern    TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
