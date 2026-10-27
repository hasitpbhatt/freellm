import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCatalogModel } from '../src/lib/api'

test('normalizeCatalogModel: preserves a well-formed catalog entry', () => {
  assert.deepEqual(
    normalizeCatalogModel({
      slug: 'stepfun-5',
      label: 'stepfun-5',
      description: null,
      capabilities: ['coding'],
      context_window: 256000,
      max_output_tokens: 4096,
      flat_rate_credits: 2000,
      routing: 'round_robin',
      access_tier: 'free',
      scoped_only: 0,
      status: 'live',
      provider_count: 1,
    }),
    {
      slug: 'stepfun-5',
      label: 'stepfun-5',
      description: null,
      capabilities: ['coding'],
      context_window: 256000,
      max_output_tokens: 4096,
      flat_rate_credits: 2000,
      routing: 'round_robin',
      access_tier: 'free',
      scoped_only: 0,
      status: 'live',
      provider_count: 1,
    },
  )
})

test('normalizeCatalogModel: malformed entries cannot crash model pages', () => {
  assert.deepEqual(normalizeCatalogModel(null), {
    slug: '',
    label: '',
    description: null,
    capabilities: [],
    context_window: null,
    max_output_tokens: 0,
    flat_rate_credits: 0,
    routing: 'unknown',
    access_tier: 'free',
    scoped_only: 0,
    status: 'unknown',
    provider_count: 0,
  })

  const normalized = normalizeCatalogModel({
    slug: 'stepfun-5',
    label: 'stepfun-5',
    description: 12,
    capabilities: ['coding', null, 7],
    context_window: -5,
    max_output_tokens: Number.NaN,
    flat_rate_credits: Number.POSITIVE_INFINITY,
    routing: null,
    status: 'retired',
    provider_count: -2.7,
  })
  assert.deepEqual(normalized.capabilities, ['coding'])
  assert.equal(normalized.description, null)
  assert.equal(normalized.context_window, null)
  assert.equal(normalized.routing, 'unknown')
  assert.equal(normalized.status, 'unknown')
  assert.equal(normalized.provider_count, 0)
})
