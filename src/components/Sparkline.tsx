type SparklinePoint = { day: string; value: number }

type SparklineProps = {
  data: SparklinePoint[]
  width?: number
  height?: number
  color?: string
  label?: string
  unit?: string
  showZeroLine?: boolean
}

/**
 * Lightweight SVG sparkline. No external deps. Renders a line chart over the
 * given points, auto-scaling Y to the data max. Missing days render as gaps
 * (line breaks) so the operator can see periods of zero usage at a glance.
 */
export function Sparkline({
  data,
  width = 120,
  height = 40,
  color = 'var(--accent)',
  label,
  unit,
  showZeroLine = true,
}: SparklineProps) {
  const points = data.filter((p) => p.value != null && Number.isFinite(p.value))
  if (points.length === 0) {
    return (
      <div className="flex h-[40px] items-center justify-center text-xs text-muted">
        No data
      </div>
    )
  }

  const max = Math.max(...points.map((p) => p.value))
  const min = Math.min(0, ...points.map((p) => p.value))
  const range = max - min || 1
  const zeroY = height - 3 - ((0 - min) / range) * (height - 6)

  const padX = 6
  const padY = 3
  const innerW = width - padX * 2
  const innerH = height - padY * 2

  const step = points.length > 1 ? innerW / (points.length - 1) : innerW

  // Build polyline segments, breaking at gaps (missing days between points).
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  let cur: { x1: number; y1: number; x2: number; y2: number } | null = null

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const x = padX + i * step
    const y = padY + innerH - ((p.value - min) / range) * innerH

    if (i > 0) {
      const prev = points[i - 1]
      const gapDays =
        (new Date(p.day).getTime() - new Date(prev.day).getTime()) / 86_400_000
      if (gapDays > 1.1) {
        // missing day(s) → break the line
        if (cur) segments.push(cur)
        cur = null
      }
    }

    if (!cur) cur = { x1: x, y1: y, x2: x, y2: y }
    else { cur.x2 = x; cur.y2 = y }

    if (i === points.length - 1 && cur) {
      segments.push(cur)
      cur = null
    }
  }

  const peakLabel = max > 0 ? max.toLocaleString('en-US') : '0'

  return (
    <div className="flex items-center gap-3 min-w-[150px]">
      <svg width={width} height={height} className="text-2xs" aria-label={label ?? 'usage trend'}>
        {showZeroLine && max > 0 && (
          <line
            x1={padX}
            x2={width - padX}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={0.6}
          />
        )}
        {segments.map((seg, i) => (
          <polyline
            key={i}
            points={`${seg.x1},${seg.y1} ${seg.x2},${seg.y2}`}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {points.length > 0 && (
          <circle
            cx={padX + (points.length - 1) * step}
            cy={padY + innerH - ((points[points.length - 1].value - min) / range) * innerH}
            r={2.5}
            fill={color}
            stroke="var(--bg)"
            strokeWidth={1.5}
          />
        )}
      </svg>
      <div className="flex flex-col min-w-0">
        {label && <span className="block text-xs font-medium text-content truncate">{label}</span>}
        <span className="block text-xs font-semibold text-content">{peakLabel}{unit ?? ''}</span>
        <span className="block text-2xs text-muted">{points.length} days</span>
      </div>
    </div>
  )
}
