// SSE client for the metered chat endpoint. Handles the passthrough deltas
// from the upstream plus freellm's own usage/settled events.

export type ChatSseEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; input: number | null; output: number | null; total: number | null; source: 'reported' | 'flat_rate' }
  | { type: 'settled'; credits_charged: number; balance: { global: number; scoped: number }; status: string; model?: string; provider?: string; latency_ms?: number; request_id?: string }

export type StreamHandlers = {
  onDelta: (content: string) => void
  onUsage?: (usage: { input: number | null; output: number | null; total: number | null; source: string }) => void
  onSettled: (event: Extract<ChatSseEvent, { type: 'settled' }>) => void
}

export type StreamResult = { completed: boolean; error?: string; status?: number; shortfall?: number; retryable?: boolean }

interface ErrorBody {
  message?: string
  shortfall?: number
  retryable?: boolean
  credits_charged?: number
}

/**
 * Streams a chat request. Resolves when the stream ends (or the caller
 * aborts via the signal). SSE keep-alives and unknown events are ignored;
 * upstream `data: {...}` chunks are decoded for delta content.
 */
export async function streamChat(
  payload: { model: string; messages: { role: string; content: string }[]; request_id: string; max_tokens?: number; key_mode?: 'byok'; key_id?: string },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<StreamResult> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return { completed: false, error: 'aborted' }
    return { completed: false, error: 'Network error — check your connection.' }
  }

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as (ErrorBody & Record<string, unknown>) | null
    const message = body?.message ?? `Chat request failed (HTTP ${response.status}).`
    return {
      completed: false,
      error: message,
      status: response.status,
      shortfall: typeof body?.shortfall === 'number' ? body.shortfall : undefined,
      retryable: typeof body?.retryable === 'boolean' ? body.retryable : undefined,
    }
  }

  const reader = response.body.getReader()
  const release = () => {
    try {
      reader.releaseLock()
    } catch {
      // already released/cancelled
    }
  }
  if (signal) {
    if (signal.aborted) {
      await reader.cancel().catch(() => {})
      release()
      return { completed: false, error: 'aborted' }
    }
    signal.addEventListener(
      'abort',
      () => {
        void reader.cancel().catch(() => {})
      },
      { once: true },
    )
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let settledReceived = false

  const handleLine = (line: string) => {
    if (!line.startsWith('data:')) return
    const raw = line.slice(5).trim()
    if (!raw || raw === '[DONE]') return
    let event: Record<string, unknown>
    try {
      event = JSON.parse(raw)
    } catch {
      return
    }
    // freellm protocol events
    if (event.type === 'usage') {
      handlers.onUsage?.({
        input: (event.input as number | null) ?? null,
        output: (event.output as number | null) ?? null,
        total: (event.total as number | null) ?? null,
        source: String(event.source ?? 'flat_rate'),
      })
      return
    }
    if (event.type === 'settled') {
      settledReceived = true
      handlers.onSettled(event as unknown as Extract<ChatSseEvent, { type: 'settled' }>)
      return
    }
    // Upstream OpenAI-compatible passthrough delta. Accept reasoning +
    // tool-call dialects so thinking models don't render empty bubbles.
    const choices = event.choices as
      | {
          delta?: { content?: unknown; reasoning_content?: unknown; text?: unknown }
          text?: unknown
          message?: { content?: unknown }
        }[]
      | undefined
    const choice = choices?.[0]
    const delta = choice?.delta as { content?: unknown; reasoning_content?: unknown; text?: unknown } | undefined
    const partText = (part: unknown): string | null => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object') {
        const t = (part as { type?: unknown; text?: unknown }).text
        if (typeof t === 'string') return t
      }
      return null
    }
    const contentParts = Array.isArray(delta?.content)
      ? (delta.content as unknown[]).map(partText).filter((t): t is string => typeof t === 'string')
      : []
    const candidates = [
      typeof delta?.content === 'string' ? delta.content : undefined,
      ...contentParts,
      typeof delta?.text === 'string' ? delta.text : undefined,
      typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : undefined,
      choice?.text,
      choice?.message?.content,
      event.content,
      event.text,
      event.token,
    ]
    const content = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
    if (content) handlers.onDelta(content)
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) handleLine(line)
    }
    // A final event may arrive without a trailing newline. Parse it rather
    // than silently dropping usage/settled metadata.
    buffer += decoder.decode()
    const tail = buffer.trim()
    if (tail && tail !== '[DONE]' && tail !== 'data: [DONE]') {
      // Tail may hold usage + settled without a final newline — split first.
      for (const line of tail.split('\n')) handleLine(line.trim())
    }
    release()
    return { completed: settledReceived }
  } catch (err) {
    try {
      await reader.cancel().catch(() => {})
    } catch {
      // ignore
    }
    release()
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { completed: false, error: 'aborted' }
    }
    return { completed: false, error: err instanceof Error ? err.message : 'Stream failed.' }
  }
}
