// Bounded JSON body reader.
//
// Image payloads are already capped per image and in aggregate, but a request
// could still contain megabytes of junk fields and force the worker to buffer
// and parse all of it before those checks run. Refuse oversized bodies first.

/** ~25 MB, enough for the 20 MB aggregate image budget plus JSON overhead. */
export const MAX_REQUEST_BODY_CHARS = 25_000_000

export type ReadJsonResult<T> = { ok: true; value: T | null } | { ok: false }

export async function readJsonBody<T>(request: Request): Promise<ReadJsonResult<T>> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_CHARS) return { ok: false }

  const text = await request.text()
  if (text.length > MAX_REQUEST_BODY_CHARS) return { ok: false }

  try {
    return { ok: true, value: JSON.parse(text) as T }
  } catch {
    return { ok: true, value: null }
  }
}
