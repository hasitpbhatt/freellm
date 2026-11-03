import { useState, type ReactNode } from 'react'
import type { SyntheticEvent } from 'react'
import { Button, Card, StatusBadge } from './ui'

interface EarnTileProps {
  id?: string
  title: string
  subtitle: string
  status: 'ready' | 'partial' | 'done' | 'locked'
  reward: string
  actionLabel: string
  onAction: () => void
  icon?: ReactNode
  children?: ReactNode
  expanded?: boolean
  onExpand?: (expanded: boolean) => void
}

export default function EarnTile({
  id,
  title,
  subtitle,
  status,
  reward,
  actionLabel,
  onAction,
  icon,
  children,
  expanded = false,
  onExpand,
}: EarnTileProps) {
  const [isExpanded, setIsExpanded] = useState(expanded)
  const [isHovered, setIsHovered] = useState(false)

  const handleSummaryToggle = (e: React.SyntheticEvent) => {
    // Prevent the summary click from bubbling if we have an onExpand handler
    if (onExpand && children) {
      e.preventDefault()
      const next = !isExpanded
      setIsExpanded(next)
      onExpand(next)
    }
  }

  const statusLabels: Record<string, string> = {
    ready: 'Ready',
    partial: 'In progress',
    done: 'Done',
    locked: 'Locked',
  }

  return (
    <Card
      id={id}
      className={`earn-tile flex flex-col ${isHovered ? 'border-accent/50 shadow-md' : ''} transition-all duration-200`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex flex-col h-full" onClick={handleSummaryToggle} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSummaryToggle(e as unknown as SyntheticEvent); } }} aria-expanded={isExpanded} aria-label={`Expand ${title}`}>
        <div className="p-4 flex flex-col gap-3 cursor-pointer">
          <div className="flex items-start gap-3">
            {icon && <span className="shrink-0 text-[22px]" aria-hidden="true">{icon}</span>}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-content truncate">{title}</h3>
                <StatusBadge status={status}>{statusLabels[status]}</StatusBadge>
              </div>
              <p className="num text-[12px] text-muted mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-line">
            <span className="num text-[13px] text-gain">{reward}</span>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={(e) => { e.stopPropagation(); onAction(); }}>
              {actionLabel}
            </Button>
          </div>
        </div>

        {children && isExpanded && (
          <div className="px-4 pb-4 pt-2 border-t border-line animate-slide-down">
            {children}
          </div>
        )}
      </div>
    </Card>
  )
}