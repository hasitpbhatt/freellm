import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { formatCredits, formatExact } from '../lib/format'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
  }
  const sizes: Record<ButtonSize, string> = {
    sm: 'btn-sm',
    md: '',
    lg: 'btn-lg',
  }
  return <button className={`${variants[variant]} ${sizes[size]} ${className}`} {...props} />
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...props} />
}

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`card ${className}`} {...props} />
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3">
      <h2 className="text-[13px] font-semibold tracking-wide text-content uppercase">{title}</h2>
      {action}
    </div>
  )
}

/** Mono credit amount with optional semantic tone. */
export function Credits({
  value,
  tone = 'neutral',
  exact = false,
  className = '',
}: {
  value: number
  tone?: 'neutral' | 'gain' | 'loss' | 'warn'
  exact?: boolean
  className?: string
}) {
  const tones = {
    neutral: 'text-content',
    gain: 'text-gain',
    loss: 'text-loss',
    warn: 'text-warn',
  }
  const text = exact ? formatExact(value) : formatCredits(value)
  return <span className={`num ${tones[tone]} ${className}`}>{text}</span>
}
