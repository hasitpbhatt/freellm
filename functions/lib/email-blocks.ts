// Admin-managed email blocklist: each row is a JS RegExp tested against the
// normalized (lowercased, trimmed) email. Patterns are unflagged — emails
// are already lowercased, so `.*@spam\.com$` matches any case.

export const EMAIL_BLOCK_PATTERN_MAX_LENGTH = 200
export const EMAIL_BLOCK_MAX_RULES = 100

/** Returns an error message when the pattern is unusable, else null. */
export function validateEmailBlockPattern(pattern: unknown): string | null {
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    return 'Pattern is required.'
  }
  if (pattern.length > EMAIL_BLOCK_PATTERN_MAX_LENGTH) {
    return `Pattern must be ${EMAIL_BLOCK_PATTERN_MAX_LENGTH} characters or fewer — keep it simple.`
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern)
  } catch {
    return 'That is not a valid regular expression.'
  }
  return null
}

/** Returns the first matching pattern for an email, or null when allowed. */
export function emailBlockedByPatterns(email: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    try {
      if (new RegExp(pattern).test(email)) return pattern
    } catch {
      // A corrupt stored row must never lock everyone out — skip it.
    }
  }
  return null
}

/** Loads all block patterns and tests the email. Null = allowed. */
export async function isEmailBlocked(db: D1Database, email: string): Promise<string | null> {
  const rows = await db
    .prepare('SELECT pattern FROM freellm_email_blocks')
    .all<{ pattern: string }>()
    .catch(() => null)
  // Table missing (migration not yet applied) = fail open, never lock out.
  if (!rows) return null
  return emailBlockedByPatterns(email, rows.results.map((r) => r.pattern))
}
