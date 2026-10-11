// Dedicated mount for the OpenAI-compatible surface at /v1 (not under /api,
// so Pages static-serving would otherwise shadow it). Same Hono app shape as
// api/[[route]].ts, serving routes/openai.ts only.

import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import openAiRoutes from '../routes/openai'
import type { Bindings, Variables } from '../lib/types'

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.route('/', openAiRoutes)

app.onError((err, c) => {
  console.error(`[v1] ${c.req.method} ${c.req.path} failed:`, err)
  return Response.json(
    { error: { message: 'Something broke on our side.', type: 'server_error', code: 'server_error' } },
    { status: 500 },
  )
})

app.notFound((c) =>
  Response.json(
    { error: { message: `No route for ${c.req.path}`, type: 'invalid_request_error', code: 'not_found' } },
    { status: 404 },
  ),
)

export const onRequest = handle(app)
