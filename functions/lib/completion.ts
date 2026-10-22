// A completion is only billable when the caller actually received text.
//
// An upstream that stops at the caller's token budget can answer with a body
// that carries no content at all. The caller gets nothing usable, so the
// request must settle as failed and cost the caller nothing. This happens in
// practice with vision models: a full meal estimate needs well over 2,000
// output tokens, and a smaller budget makes the upstream cut off before it
// emits anything.

export const EMPTY_COMPLETION_REASON = 'upstream returned an empty completion'

/** True when there is real content to bill for. */
export function isBillableCompletion(content: string | null | undefined): boolean {
  return typeof content === 'string' && content.trim().length > 0
}
