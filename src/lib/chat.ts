// SSE client for the metered chat endpoint. Handles the passthrough deltas
// from the upstream plus freellm's own usage/settled events.

import { ApiError } from './api'

export type ChatSseEvent =
  | { type: 'delta'; content: string }
  | { type: 'usage'; input: number | null; output: number | null; total: number | null; source: 'reported' | 'flat_rate' }
  | { type: 'settled'; credits_charged: number; balance: { global: number; scoped: number }; status: string }

export type StreamHandlers = {
  onDelta: (content: string) => void
  onUsage?: (usage: { input: number | null; output: number | null; total: number | null; source: string }) => void
  onSettled: (event: Extract<ChatSseEvent, { type: 'settled' }>) => void
}

export type StreamResult = { completed: boolean; error?: string }

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
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    if (response.status === 402) {
      return { completed: false, error: body?.message ?? 'Not enough credits.' }
    }
    throw new ApiError(response.status, 'chat_failed', body?.message ?? 'Chat request failed.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === '[DONE]') continue
        let event: Record<string, unknown>
        try {
          event = JSON.parse(raw)
        } catch {
          continue
        }
        // freellm protocol events
        if (event.type === 'usage') {
          handlers.onUsage?.({
            input: (event.input as number | null) ?? null,
            output: (event.output as number | null) ?? null,
            total: (event.total as number | null) ?? null,
            source: String(event.source ?? 'flat_rate'),
          })
          continue
        }
        if (event.type === 'settled') {
          handlers.onSettled(event as unknown as Extract<ChatSseEvent, { type: 'settled' }>)
          continue
        }
        // upstream OpenAI-compatible passthrough delta
        const choices = event.choices as { delta?: { content?: string } }[] | undefined
        const content = choices?.[0]?.delta?.content
        if (typeof content === 'string' && content.length > 0) handlers.onDelta(content)
      }
    }
    return { completed: true }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { completed: false, error: 'aborted' }
    }
    return { completed: false, error: err instanceof Error ? err.message : 'Stream failed.' }
  }
}
