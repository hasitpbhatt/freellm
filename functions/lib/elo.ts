// Elo: pairwise rating updates for arena battles.
//
// A battle of N models produces N-1 pairwise results for the winner. K is
// higher for young models (fast calibration) and settles as games accumulate.

const K_YOUNG = 32 // fewer than 30 games
const K_SETTLED = 16

export function kFactor(games: number): number {
  return games < 30 ? K_YOUNG : K_SETTLED
}

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400))
}

export type EloUpdate = { slug: string; before: number; after: number; delta: number }

/**
 * Applies one battle's result: `winner` beats every other model pairwise.
 * Returns the per-model rating changes; persisting them is the caller's job.
 */
export function eloBattle(
  ratings: Map<string, { rating: number; games: number }>,
  winner: string,
): EloUpdate[] {
  const winnerEntry = ratings.get(winner)
  if (!winnerEntry) return []

  const updates = new Map<string, EloUpdate>()
  const winnerBefore = winnerEntry.rating
  let winnerRating = winnerEntry.rating

  for (const [slug, entry] of ratings) {
    if (slug === winner) continue
    const k = kFactor(entry.games)
    const winnerExpected = expectedScore(winnerRating, entry.rating)
    const loserExpected = expectedScore(entry.rating, winnerRating)
    winnerRating += k * (1 - winnerExpected)
    const loserAfter = entry.rating + k * (0 - loserExpected)
    updates.set(slug, { slug, before: entry.rating, after: Math.round(loserAfter), delta: 0 })
  }

  updates.set(winner, { slug: winner, before: winnerBefore, after: Math.round(winnerRating), delta: 0 })
  const result = [...updates.values()]
  for (const update of result) update.delta = update.after - update.before
  return result
}
