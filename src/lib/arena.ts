// Streaming client for arena battles (blinded, label-tagged SSE).

import { ApiError } from './api'

export type BattleStreamEvent =
  | { type: 'battle'; id: string; prompt: string; labels: { label: string; estimate: number }[] }
  | { type: 'start'; label: string }
  | { type: 'delta'; label: string; content: string }
  | { type: 'settled'; label: string; credits: number; source: string; usage: { input: number; output: number; total: number } | null }
  | { type: 'error'; label: string; message: string }
  | { type: 'done'; battle_id: string }

export type BattleHandlers = {
  onEvent: (event: BattleStreamEvent) => void
}

export async function streamBattle(
  payload: { prompt: string; models: string[] },
  handlers: BattleHandlers,
): Promise<{ ok: boolean; error?: string }> {
  let response: Response
  try {
    response = await fetch('/api/battles', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, error: 'Network error — check your connection.' }
  }

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    if (response.status === 402) return { ok: false, error: body?.message ?? 'Not enough credits for this battle.' }
    throw new ApiError(response.status, 'battle_failed', body?.message ?? 'Battle failed to start.')
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
        try {
          handlers.onEvent(JSON.parse(raw) as BattleStreamEvent)
        } catch {
          // ignore malformed keep-alives
        }
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Stream failed.' }
  }
}
