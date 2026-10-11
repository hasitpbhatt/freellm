import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eloBattle, expectedScore, kFactor } from '../functions/lib/elo'

test('kFactor: young models calibrate fast, settled models move slowly', () => {
  assert.equal(kFactor(0), 32)
  assert.equal(kFactor(29), 32)
  assert.equal(kFactor(30), 16)
  assert.equal(kFactor(500), 16)
})

test('expectedScore: symmetric and centred', () => {
  assert.equal(expectedScore(1500, 1500), 0.5)
  const strong = expectedScore(1700, 1500)
  const weak = expectedScore(1500, 1700)
  assert.ok(strong > 0.5)
  assert.ok(weak < 0.5)
  assert.ok(Math.abs(strong + weak - 1) < 1e-12, 'probabilities must sum to 1')
  assert.ok(Math.abs(expectedScore(1400, 1500) - expectedScore(1500, 1600)) < 1e-12, 'only the gap matters')
})

test('eloBattle: winner gains, loser drops', () => {
  const ratings = new Map([
    ['a', { rating: 1500, games: 10 }],
    ['b', { rating: 1500, games: 10 }],
  ])
  const updates = eloBattle(ratings, 'a')
  const a = updates.find((u) => u.slug === 'a')!
  const b = updates.find((u) => u.slug === 'b')!
  assert.ok(a.after > 1500)
  assert.ok(b.after < 1500)
  assert.equal(a.delta, a.after - a.before)
  assert.ok(b.delta < 0)
  assert.equal(a.after, 1516)
  assert.equal(b.after, 1484)
})

test('eloBattle: an upset moves more than a foregone conclusion', () => {
  // Underdog (1500) beats favourite (1700) vs favourite (1700) beats underdog.
  const upset = eloBattle(
    new Map([
      ['underdog', { rating: 1500, games: 50 }],
      ['favourite', { rating: 1700, games: 50 }],
    ]),
    'underdog',
  ).find((u) => u.slug === 'underdog')!
  const expectedWin = eloBattle(
    new Map([
      ['underdog', { rating: 1500, games: 50 }],
      ['favourite', { rating: 1700, games: 50 }],
    ]),
    'favourite',
  ).find((u) => u.slug === 'favourite')!
  assert.ok(upset.delta > expectedWin.delta, 'upsets are worth more points')
})

test('eloBattle: settles as the winner accumulates games', () => {
  // Young loser (K=32) drops more than a settled loser (K=16).
  const young = eloBattle(
    new Map([
      ['w', { rating: 1500, games: 0 }],
      ['l', { rating: 1500, games: 0 }],
    ]),
    'w',
  ).find((u) => u.slug === 'l')!
  const settled = eloBattle(
    new Map([
      ['w', { rating: 1500, games: 50 }],
      ['l', { rating: 1500, games: 50 }],
    ]),
    'w',
  ).find((u) => u.slug === 'l')!
  assert.ok(Math.abs(young.delta) > Math.abs(settled.delta))
})

test('eloBattle: 4-way battle updates every model exactly once', () => {
  const ratings = new Map([
    ['a', { rating: 1500, games: 3 }],
    ['b', { rating: 1500, games: 3 }],
    ['c', { rating: 1500, games: 3 }],
    ['d', { rating: 1500, games: 3 }],
  ])
  const updates = eloBattle(ratings, 'a')
  assert.equal(updates.length, 4)
  assert.equal(new Set(updates.map((u) => u.slug)).size, 4, 'one update per slug')

  // The winner's rating is re-based after each pairwise win (sequential Elo),
  // so the three wins are worth progressively less than a flat 3 × 16.
  assert.equal(updates.find((u) => u.slug === 'a')!.delta, 46)
  assert.equal(updates.find((u) => u.slug === 'b')!.delta, -16)
  assert.equal(updates.find((u) => u.slug === 'c')!.delta, -15)
  assert.equal(updates.find((u) => u.slug === 'd')!.delta, -15)
})

test('eloBattle: unknown winner returns no updates', () => {
  const ratings = new Map([['a', { rating: 1500, games: 1 }]])
  assert.deepEqual(eloBattle(ratings, 'ghost'), [])
})
