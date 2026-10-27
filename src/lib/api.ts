export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body?.error as string) ?? 'unknown',
      (body?.message as string) ?? res.statusText,
    )
  }
  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

export type CatalogModel = {
  slug: string
  label: string
  description: string | null
  capabilities: string[]
  context_window: number | null
  max_output_tokens: number
  flat_rate_credits: number
  routing: string
  access_tier: string
  scoped_only: number
  status: 'live' | 'slow' | 'down' | 'unknown'
  provider_count: number
}

const MODEL_STATUSES: CatalogModel['status'][] = ['live', 'slow', 'down', 'unknown']

/**
 * Normalizes one catalog entry so malformed API data cannot crash a page.
 * Unknown or missing fields fall back to safe display values.
 */
export function normalizeCatalogModel(model: unknown): CatalogModel {
  const value = (model ?? {}) as Partial<Record<keyof CatalogModel, unknown>>
  const text = (input: unknown, fallback = ''): string =>
    typeof input === 'string' ? input : fallback
  const finiteNumber = (input: unknown, fallback: number): number =>
    typeof input === 'number' && Number.isFinite(input) ? input : fallback
  const status = value.status
  const contextWindow = finiteNumber(value.context_window, NaN)

  return {
    slug: text(value.slug),
    label: text(value.label),
    description: typeof value.description === 'string' ? value.description : null,
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.filter((tag): tag is string => typeof tag === 'string')
      : [],
    context_window: Number.isInteger(contextWindow) && contextWindow > 0 ? contextWindow : null,
    max_output_tokens: Math.max(0, Math.floor(finiteNumber(value.max_output_tokens, 0))),
    flat_rate_credits: Math.max(0, Math.floor(finiteNumber(value.flat_rate_credits, 0))),
    routing: text(value.routing, 'unknown'),
    access_tier: ['free', 'pro', 'enterprise'].includes(value.access_tier as string)
      ? (value.access_tier as string)
      : 'free',
    scoped_only: value.scoped_only === 1 ? 1 : 0,
    status: MODEL_STATUSES.includes(status as CatalogModel['status'])
      ? (status as CatalogModel['status'])
      : 'unknown',
    provider_count: Math.max(0, Math.floor(finiteNumber(value.provider_count, 0))),
  }
}
