const UNITS = ['', 'K', 'M', 'B'] as const

/** 1_247_392 -> "1.25M" · 124_739 -> "124.7K" · 999 -> "999" */
export function formatCredits(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  let value = Math.abs(n)
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const decimals = unit === 0 ? 0 : value < 10 ? 2 : 1
  return `${sign}${value.toFixed(decimals).replace(/\.0+$/, '')}${UNITS[unit]}`
}

/** Exact integer with thin-space grouping: 1247392 -> "1 247 392" */
export function formatExact(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Signed delta for ledger rows: +50,000 / −4,231 */
export function formatDelta(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${formatExact(Math.abs(n))}`
}
