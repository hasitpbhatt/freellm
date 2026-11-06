import type { ReactNode } from 'react'
import { useState, useMemo, useRef, useCallback } from 'react'
import { formatCredits } from '../lib/format'
import { Sparkline } from './Sparkline'

type SparklinePoint = { day: string; value: number }

/* ============================================================
   MetricCard — stat card with optional trend sparkline
   ============================================================ */
export interface MetricCardProps {
  title: string
  value: string | number
  tone?: 'neutral' | 'gain' | 'loss' | 'warn'
  trend?: {
    data: SparklinePoint[]
    color?: string
    label?: string
  }
  subtitle?: string
  action?: ReactNode
  className?: string
}

export function MetricCard({
  title,
  value,
  tone = 'neutral',
  trend,
  subtitle,
  action,
  className = '',
}: MetricCardProps) {
  const tones = {
    neutral: 'text-content',
    gain: 'text-gain',
    loss: 'text-loss',
    warn: 'text-warn',
  }

  const displayValue = typeof value === 'number' ? formatCredits(value) : value

  return (
    <div className={`card p-4 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted uppercase tracking-wide">{title}</p>
          <p className={`mt-1 text-2xl font-semibold ${tones[tone]} tabular-nums`}>{displayValue}</p>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          {trend && (
            <div className="mt-3">
              <Sparkline
                data={trend.data}
                width={140}
                height={44}
                color={trend.color ?? 'var(--accent)'}
                label={trend.label}
                showZeroLine={false}
              />
            </div>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  )
}

/* ============================================================
   FilterChipBar — URL-synced chip filters
   ============================================================ */
export interface FilterChip {
  key: string
  label: string
  value: string
  count?: number
}

export interface FilterChipBarProps {
  filters: FilterChip[]
  activeKeys: string[]
  onChange: (keys: string[]) => void
  multiple?: boolean
  className?: string
}

export function FilterChipBar({ filters, activeKeys, onChange, multiple = true, className = '' }: FilterChipBarProps) {
  const isActive = (key: string) => activeKeys.includes(key)

  const handleClick = (key: string) => {
    let nextKeys: string[]
    if (multiple) {
      nextKeys = isActive(key) ? activeKeys.filter((k) => k !== key) : [...activeKeys, key]
    } else {
      nextKeys = isActive(key) ? [] : [key]
    }
    onChange(nextKeys)
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} role="group" aria-label="Filters">
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
          onClick={() => handleClick(filter.key)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg ${
            isActive(filter.key)
              ? 'bg-accent text-white'
              : 'bg-surface-2 text-content hover:bg-surface-3'
          }`}
          aria-pressed={isActive(filter.key)}
        >
          {filter.label}
          {filter.count != null && (
            <span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${isActive(filter.key) ? 'bg-white/20' : 'bg-surface-3'}`}>
              {filter.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/* ============================================================
   VirtualizedTable — high-performance table for 1000+ rows
   ============================================================ */
export interface ColumnDef<T> {
  key: string
  header: string
  width?: string
  minWidth?: string
  render: (row: T, index: number) => ReactNode
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
}

export interface VirtualizedTableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  rowKey: (row: T) => string
  height: number
  rowHeight?: number
  overscan?: number
  emptyMessage?: string
  loading?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  onSort?: (key: string, dir: 'asc' | 'desc') => void
  selectedKeys?: Set<string>
  onSelectionChange?: (keys: Set<string>) => void
  className?: string
}

export function VirtualizedTable<T>({
  columns,
  data,
  rowKey,
  height,
  rowHeight = 44,
  overscan = 5,
  emptyMessage = 'No data',
  loading = false,
  sortBy,
  sortDir,
  onSort,
  selectedKeys = new Set(),
  onSelectionChange,
  className = '',
}: VirtualizedTableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const visibleCount = Math.ceil(height / rowHeight)
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const endIndex = Math.min(data.length, startIndex + visibleCount + overscan * 2)
  const visibleRows = data.slice(startIndex, endIndex)
  const offsetY = startIndex * rowHeight

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const handleRowClick = (row: T) => {
    if (!onSelectionChange) return
    const key = rowKey(row)
    const next = new Set(selectedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectionChange(next)
  }

  const handleSelectAll = () => {
    if (!onSelectionChange) return
    if (selectedKeys.size === data.length) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(data.map(rowKey)))
    }
  }

  if (loading) {
    return (
      <div className={`relative ${className}`} style={{ height }}>
        <div className="absolute inset-0 flex items-center justify-center text-muted">
          Loading…
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className={`relative ${className}`} style={{ height }}>
        <div className="absolute inset-0 flex items-center justify-center text-muted">
          {emptyMessage}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`relative overflow-auto border border-line rounded-lg ${className}`}
      style={{ height }}
    >
      <div style={{ height: data.length * rowHeight, position: 'relative' }}>
        {/* Fixed header */}
        <div className="sticky top-0 z-10 bg-surface border-b border-line">
          <table className="w-full border-collapse" role="grid">
            <thead>
              <tr>
                {onSelectionChange && (
                  <th className="w-10 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={selectedKeys.size === data.length && data.length > 0}
                      onChange={handleSelectAll}
                      className="input w-4 h-4"
                      aria-label="Select all"
                      ref={(el) => {
                        if (el) el.indeterminate = selectedKeys.size > 0 && selectedKeys.size < data.length
                      }}
                    />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`px-3 py-2 text-xs font-semibold text-muted uppercase tracking-wide text-left ${
                      col.sortable ? 'cursor-pointer hover:text-content select-none' : ''
                    }`}
                    style={{ width: col.width, minWidth: col.minWidth }}
                    onClick={() => col.sortable && onSort?.(col.key, sortBy === col.key && sortDir === 'asc' ? 'desc' : 'asc')}
                    aria-sort={sortBy === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <div className="flex items-center gap-1.5">
                      {col.header}
                      {col.sortable && sortBy === col.key && (
                        <svg className="w-3 h-3 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sortDir === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                        </svg>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>

        {/* Scrollable body */}
        <table className="w-full border-collapse" style={{ transform: `translateY(${offsetY}px)` }}>
            <tbody>
              {visibleRows.map((row, i) => {
                const absoluteIndex = startIndex + i
                const key = rowKey(row)
                const isSelected = selectedKeys.has(key)
                return (
                  <tr
                    key={key}
                    className={`border-t border-line transition-colors ${isSelected ? 'bg-accent/10' : 'hover:bg-surface-2'}`}
                    onClick={() => handleRowClick(row)}
                  >
                    {onSelectionChange && (
                      <td className="w-10 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            e.stopPropagation()
                            handleRowClick(row)
                          }}
                          className="input w-4 h-4"
                          aria-label={`Select row ${absoluteIndex + 1}`}
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2 text-sm ${col.align === 'center' ? 'text-center' : col.align === 'right' ? 'text-right' : ''}`}
                        style={{ width: col.width, minWidth: col.minWidth }}
                      >
                        {col.render(row, absoluteIndex)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
      </div>
    </div>
  )
}

/* ============================================================
   SparklinePlus — enhanced sparkline with tooltip & gradient
   ============================================================ */
export interface SparklinePlusProps {
  data: SparklinePoint[]
  width?: number
  height?: number
  color?: string
  gradient?: boolean
  showTooltip?: boolean
  tooltipFormatter?: (value: number) => string
  className?: string
}

export function SparklinePlus({
  data,
  width = 200,
  height = 50,
  color = 'var(--accent)',
  gradient = false,
  showTooltip = true,
  tooltipFormatter,
  className = '',
}: SparklinePlusProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const points = useMemo(() => data.filter((p) => p.value != null && Number.isFinite(p.value)), [data])

  if (points.length === 0) {
    return (
      <div className={`flex h-[50px] items-center justify-center text-xs text-muted ${className}`}>
        No data
      </div>
    )
  }

  const max = Math.max(...points.map((p) => p.value))
  const min = Math.min(0, ...points.map((p) => p.value))
  const range = max - min || 1

  const padX = 8
  const padY = 4
  const innerW = width - padX * 2
  const innerH = height - padY * 2

  const step = points.length > 1 ? innerW / (points.length - 1) : innerW

  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  let cur: { x1: number; y1: number; x2: number; y2: number } | null = null

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const x = padX + i * step
    const y = padY + innerH - ((p.value - min) / range) * innerH

    if (i > 0) {
      const prev = points[i - 1]
      const gapDays = (new Date(p.day).getTime() - new Date(prev.day).getTime()) / 86_400_000
      if (gapDays > 1.1) {
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

  const gradientId = `sparkline-gradient-${Math.random().toString(36).slice(2, 9)}`

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!showTooltip || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const index = Math.round((x - padX) / step)
    const clamped = Math.max(0, Math.min(points.length - 1, index))
    setHoverIndex(clamped)
  }

  const handleMouseLeave = () => {
    setHoverIndex(null)
  }

  const hoveredPoint = hoverIndex != null ? points[hoverIndex] : null

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="text-2xs"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        aria-label="Usage trend"
      >
        {gradient && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
        )}
        {gradient && (
          <path
            d={
              segments
                .map((seg, i) => {
                  if (i === 0) return `M${seg.x1},${height - padY} L${seg.x1},${seg.y1} L${seg.x2},${seg.y2}`
                  return `L${seg.x2},${seg.y2}`
                })
                .join(' ') + ` L${segments[segments.length - 1].x2},${height - padY} Z`
            }
            fill={`url(#${gradientId})`}
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
        {hoveredPoint && (
          <>
            <line
              x1={padX + hoverIndex! * step}
              y1={padY}
              x2={padX + hoverIndex! * step}
              y2={height - padY}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.6}
            />
            <circle
              cx={padX + hoverIndex! * step}
              cy={padY + innerH - ((hoveredPoint.value - min) / range) * innerH}
              r={4}
              fill={color}
              stroke="var(--bg)"
              strokeWidth={2}
            />
          </>
        )}
        {!hoveredPoint && points.length > 0 && (
          <circle
            cx={padX + (points.length - 1) * step}
            cy={padY + innerH - ((points[points.length - 1].value - min) / range) * innerH}
            r={3}
            fill={color}
            stroke="var(--bg)"
            strokeWidth={1.5}
          />
        )}
      </svg>
      {showTooltip && hoveredPoint && (
        <div
          className="absolute z-10 px-2 py-1 bg-surface border border-line rounded text-xs font-mono text-content pointer-events-none animate-slide-up"
          style={{
            left: padX + hoverIndex! * step,
            bottom: height - padY + 8,
            transform: 'translateX(-50%)',
          }}
        >
          {tooltipFormatter ? tooltipFormatter(hoveredPoint.value) : formatCredits(hoveredPoint.value)}
          <div className="text-2xs text-muted">{hoveredPoint.day}</div>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   StreakHero — animated streak ring with milestone preview
   ============================================================ */
export interface StreakHeroProps {
  currentDay: number
  maxDay: number
  nextMilestoneDay: number
  nextMilestoneReward: string
  streakFreezeAvailable: boolean
  onFreezeClick?: () => void
  className?: string
}

export function StreakHero({
  currentDay,
  maxDay,
  nextMilestoneDay,
  nextMilestoneReward,
  streakFreezeAvailable,
  onFreezeClick,
  className = '',
}: StreakHeroProps) {
  const progress = Math.min(currentDay / maxDay, 1)
  const circumference = 2 * Math.PI * 48 // r=48
  const offset = circumference * (1 - progress)

  return (
    <div className={`card p-6 relative ${className}`}>
      <div className="flex items-center justify-between">
        <div className="relative w-28 h-28 flex-shrink-0">
          <svg className="w-full h-full -rotate-90">
            <circle
              cx="64"
              cy="64"
              r="48"
              fill="none"
              stroke="var(--border)"
              strokeWidth="8"
            />
            <circle
              cx="64"
              cy="64"
              r="48"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-all duration-1000 ease-out"
              style={{ transitionDuration: '800ms' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-content">{currentDay}</span>
            <span className="text-xs text-muted uppercase tracking-wide">Day Streak</span>
          </div>
        </div>
        <div className="flex-1 ml-6 min-w-0">
          <p className="text-sm text-muted">Next milestone</p>
          <p className="text-lg font-semibold text-content mt-1">Day {nextMilestoneDay}</p>
          <p className="text-sm text-gain mt-1">+{nextMilestoneReward}</p>
          <div className="mt-4 h-2 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-1000 ease-out"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
        {streakFreezeAvailable && onFreezeClick && (
          <button
            onClick={onFreezeClick}
            className="btn-secondary flex-shrink-0"
            aria-label="Use streak freeze"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Freeze
          </button>
        )}
      </div>
    </div>
  )
}