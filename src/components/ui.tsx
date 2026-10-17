import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
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

/** Shared loading placeholder — keeps the spinner copy consistent. */
export function LoadingState({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return <p className={`py-12 text-center text-[13px] text-muted ${className}`} role="status">{label}</p>
}

/** Shared empty-state block. */
export function EmptyState({ title, children, className = '' }: { title?: string; children?: ReactNode; className?: string }) {
  return (
    <Card className={`p-8 text-center text-[13px] text-muted ${className}`}>
      {title && <p className="font-medium text-content">{title}</p>}
      {children && <div className="mt-1">{children}</div>}
    </Card>
  )
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3">
      <h2 className="text-[13px] font-semibold tracking-wide text-content uppercase">{title}</h2>
      {action}
    </div>
  )
}

interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  [key: string]: unknown
}

interface SelectProps<T extends SelectOption> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'children'> {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  options: readonly T[]
  renderOption?: (opt: T) => ReactNode
  disabled?: boolean
}

export function Select<T extends SelectOption>({
  value,
  onChange,
  placeholder,
  options,
  renderOption,
  disabled,
  className = '',
  ...props
}: SelectProps<T>) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`input appearance-none pr-10 ${className}`}
        {...props}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {renderOption ? renderOption(opt) : opt.label}
          </option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none text-muted">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
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
