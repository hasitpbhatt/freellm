// Shared KV-backed rate limiter (sliding window counter).
//
// Returns false when the caller is over the limit. Used by auth and any route
// that needs a cheap per-IP or per-user throttle. Keep the semantics identical
// to the historic in-route implementation so existing callers behave the same.

export async function allowRequest(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = Date.now()
  const raw = await kv.get(key)
  let entry = { count: 0, resetAt: now + windowSeconds * 1000 }
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { count: number; resetAt: number }
      if (parsed && typeof parsed.count === 'number') entry = parsed
    } catch {
      /* corrupt entry -> reset */
    }
  }
  if (now > entry.resetAt) entry = { count: 0, resetAt: now + windowSeconds * 1000 }
  entry.count += 1
  await kv.put(key, JSON.stringify(entry), { expirationTtl: windowSeconds })
  return entry.count <= limit
}
