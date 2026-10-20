// OpenAI-compatible message parsing for the /v1 surface.
//
// The gateway forwards messages verbatim to upstreams, so only well-formed,
// bounded content may pass: either a plain string (classic text chat) or an
// array of content parts for vision-capable models. Unknown part types are
// rejected rather than forwarded, and image payloads are capped so a single
// request cannot balloon into an unbounded (and expensive) upload.

export type TextPart = { type: 'text'; text: string }
export type ImagePart = { type: 'image_url'; image_url: { url: string; detail?: string } }
export type ChatContentPart = TextPart | ImagePart

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatContentPart[]
}

/** Per-message text budget (same cap the text-only route always enforced). */
export const MAX_MESSAGE_TEXT_CHARS = 100_000

/** ~7.5 MB of binary data once base64 is decoded. */
export const MAX_IMAGE_URL_CHARS = 10_000_000

/**
 * Vision requests cost real upstream tokens; keep the fan-out small. The chat
 * UI keeps images in history for follow-up questions, so the request budget
 * allows a few turns rather than a single message.
 */
export const MAX_IMAGES_PER_REQUEST = 8

/** Aggregate payload ceiling so many individually valid images cannot add up to an unbounded body. */
export const MAX_TOTAL_IMAGE_URL_CHARS = 20_000_000

const ROLES = new Set<string>(['system', 'user', 'assistant'])
const IMAGE_DETAILS = new Set<string>(['auto', 'low', 'high'])
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i

type ImageBudget = { remaining: number; remainingChars: number }

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const octets = match.slice(1).map(Number)
  if (octets.some((n) => n > 255)) return true
  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/**
 * Upstreams fetch image URLs server-side, so only public HTTPS URLs and
 * base64 image data are forwarded. This blocks file://, http://, and
 * cloud-metadata/localhost targets from turning the gateway into an SSRF
 * proxy. (Upstreams still perform their own fetch; this is defense in depth.)
 */
export function isAllowedImageUrl(url: string): boolean {
  if (DATA_IMAGE.test(url)) return true
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:')
  ) {
    return false
  }
  return !isPrivateIpv4(host)
}

function parseImagePart(raw: unknown): ImagePart | null {
  if (!raw || typeof raw !== 'object') return null
  const url = (raw as { url?: unknown }).url
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_IMAGE_URL_CHARS) return null
  if (!isAllowedImageUrl(url)) return null
  const detail = (raw as { detail?: unknown }).detail
  const normalizedDetail =
    typeof detail === 'string' && IMAGE_DETAILS.has(detail) ? detail : undefined
  return {
    type: 'image_url',
    image_url: { url, ...(normalizedDetail ? { detail: normalizedDetail } : {}) },
  }
}

/**
 * Parses one message's `content` field. Returns null when the shape is
 * unsupported or exceeds a limit, so the caller can drop the message.
 */
export function parseContent(raw: unknown, budget: ImageBudget): string | ChatContentPart[] | null {
  if (typeof raw === 'string') return raw.length <= MAX_MESSAGE_TEXT_CHARS ? raw : null
  if (!Array.isArray(raw) || raw.length === 0) return null

  const parts: ChatContentPart[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const type = (item as { type?: unknown }).type

    if (type === 'text') {
      const text = (item as { text?: unknown }).text
      if (typeof text !== 'string') return null
      parts.push({ type: 'text', text })
      continue
    }

    if (type === 'image_url') {
      if (budget.remaining <= 0) return null
      const part = parseImagePart((item as { image_url?: unknown }).image_url)
      if (!part || part.image_url.url.length > budget.remainingChars) return null
      budget.remaining -= 1
      budget.remainingChars -= part.image_url.url.length
      parts.push(part)
      continue
    }

    return null
  }

  return parts
}

export type ParseMessagesResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; error: string }

/**
 * Sanitizes a raw `messages` array for forwarding.
 *
 * Invalid content is a hard error: a paid request must never silently lose a
 * system instruction or an image. The caller turns `{ ok: false }` into a 400
 * that names the offending message.
 */
export function parseOpenAiMessages(raw: unknown): ParseMessagesResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'messages must be an array.' }
  if (raw.length === 0) return { ok: false, error: 'messages must not be empty.' }

  const budget: ImageBudget = {
    remaining: MAX_IMAGES_PER_REQUEST,
    remainingChars: MAX_TOTAL_IMAGE_URL_CHARS,
  }
  const messages: ChatMessage[] = []

  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index]
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `messages[${index}] must be an object.` }
    }
    const role = (item as { role?: unknown }).role
    if (typeof role !== 'string' || !ROLES.has(role)) {
      return { ok: false, error: `messages[${index}].role must be system, user, or assistant.` }
    }

    const content = parseContent((item as { content?: unknown }).content, budget)
    if (content === null || contentTextLength(content) > MAX_MESSAGE_TEXT_CHARS) {
      return { ok: false, error: `messages[${index}].content is invalid or exceeds the size limit.` }
    }

    messages.push({ role: role as ChatMessage['role'], content })
  }

  return { ok: true, messages }
}

/** Total text characters across a message's content (image URLs excluded). */
export function contentTextLength(content: string | ChatContentPart[]): number {
  if (typeof content === 'string') return content.length
  return content.reduce((total, part) => total + (part.type === 'text' ? part.text.length : 0), 0)
}

/** Number of image parts in a message. */
export function contentImageCount(content: string | ChatContentPart[]): number {
  if (typeof content === 'string') return 0
  return content.reduce((count, part) => count + (part.type === 'image_url' ? 1 : 0), 0)
}
