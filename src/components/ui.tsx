import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { createContext, useContext, useState } from 'react'
import { formatCredits, formatExact } from '../lib/format'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
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
    danger: 'btn-danger',
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
  return <p className={`py-12 text-center text-sm text-muted ${className}`} role="status">{label}</p>
}

/** Shared empty-state block. */
export function EmptyState({ title, children, className = '' }: { title?: string; children?: ReactNode; className?: string }) {
  return (
    <Card className={`p-8 text-center text-sm text-muted ${className}`}>
      {title && <p className="font-medium text-content">{title}</p>}
      {children && <div className="mt-1">{children}</div>}
    </Card>
  )
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-4 py-3">
      <h2 className="text-sm font-semibold tracking-wide text-content uppercase">{title}</h2>
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

export function StatusBadge({
  status,
  children,
}: {
  status: 'ready' | 'partial' | 'done' | 'locked'
  children: ReactNode
}) {
  const colors = {
    ready: 'text-gain',
    partial: 'text-warn',
    done: 'text-muted',
    locked: 'text-line',
  }
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${colors[status]}`}>
      <span className="w-2 h-2 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  )
}

export interface TabsProps {
  value: string
  onValueChange: (value: string) => void
  className?: string
  children: ReactNode
}

export interface TabsListProps {
  className?: string
  children: ReactNode
}

export interface TabsTriggerProps {
  value: string
  className?: string
  children: ReactNode
  disabled?: boolean
}

export interface TabsContentProps {
  value: string
  className?: string
  children: ReactNode
}

export function Tabs({ value, onValueChange, className = '', children }: TabsProps) {
  // Provide context for child components
  const ctx = { value, onValueChange }
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

const TabsContext = createContext<{ value: string; onValueChange: (value: string) => void } | null>(null)

export function TabsList({ className = '', children }: TabsListProps) {
  return <div className={className} role="tablist">{children}</div>
}

export function TabsTrigger({ value, className = '', children, disabled }: TabsTriggerProps) {
  const ctx = useContext(TabsContext)
  const handleClick = () => {
    if (!disabled && ctx) {
      ctx.onValueChange(value)
    }
  }
  const isActive = ctx?.value === value
  return (
    <button
      role="tab"
      aria-selected={isActive}
      aria-disabled={disabled}
      className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-accent ${disabled ? 'opacity-50 pointer-events-none' : ''} ${isActive ? 'bg-accent text-accent-fg' : ''} ${className}`}
      onClick={handleClick}
    >
      {children}
    </button>
  )
}

export function TabsContent({ value, className = '', children }: TabsContentProps) {
  const ctx = useContext(TabsContext)
  const isActive = ctx?.value === value
  if (!isActive) return null
  return <div className={className} role="tabpanel">{children}</div>
}

/** Toast notification types */
type ToastType = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number
}

interface ToastContextValue {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => string
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/** ToastProvider — wraps app to provide toast context */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2, 9)
    const newToast = { ...toast, id, duration: toast.duration ?? 4000 }
    setToasts((prev) => [...prev, newToast])
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => removeToast(id), newToast.duration)
    }
    return id
  }

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

/** Hook to access toast context */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

/** Individual toast component */
function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const typeStyles: Record<ToastType, string> = {
    success: 'border-gain/30 bg-gain/10',
    error: 'border-loss/30 bg-loss/10',
    warning: 'border-warn/30 bg-warn/10',
    info: 'border-accent/30 bg-accent/10',
  }
  const iconStyles: Record<ToastType, string> = {
    success: 'text-gain',
    error: 'text-loss',
    warning: 'text-warn',
    info: 'text-accent',
  }
  const icons: Record<ToastType, ReactNode> = {
    success: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>,
    error: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
    warning: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
    info: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  }

  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg border animate-slide-up ${typeStyles[toast.type]}`} role="alert">
      <div className={`flex-shrink-0 ${iconStyles[toast.type]}`}>{icons[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-content">{toast.title}</p>
        {toast.message && <p className="mt-0.5 text-sm text-muted">{toast.message}</p>}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 p-1 text-muted hover:text-content transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}

/** Toast container — renders all active toasts */
function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-container flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onRemove={onRemove} />
        </div>
      ))}
    </div>
  )
}

/** ConfirmModal — accessible replacement for window.confirm() */
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false,
}: {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'primary'
  loading?: boolean
}) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay animate-slide-up" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal-content bg-surface rounded-xl border border-line animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-line">
          <h2 id="confirm-title" className="text-lg font-semibold text-content">{title}</h2>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-line">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={variant} size="sm" onClick={onConfirm} disabled={loading} autoFocus>
            {loading ? '…' : confirmText}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Hook for programmatic confirm dialogs */
export function useConfirm() {
  const [state, setState] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => void
    variant: 'danger' | 'primary'
    confirmText: string
    cancelText: string
    loading: boolean
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    variant: 'danger',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    loading: false,
  })

  const confirm = (options: {
    title: string
    message: string
    onConfirm: () => void
    variant?: 'danger' | 'primary'
    confirmText?: string
    cancelText?: string
  }) => {
    setState({
      isOpen: true,
      title: options.title,
      message: options.message,
      onConfirm: options.onConfirm,
      variant: options.variant ?? 'danger',
      confirmText: options.confirmText ?? 'Confirm',
      cancelText: options.cancelText ?? 'Cancel',
      loading: false,
    })
  }

  const handleConfirm = () => {
    setState((prev) => ({ ...prev, loading: true }))
    state.onConfirm()
    setState((prev) => ({ ...prev, isOpen: false, loading: false }))
  }

  const handleCancel = () => {
    setState((prev) => ({ ...prev, isOpen: false }))
  }

  return {
    confirm,
    ConfirmModal: (
      <ConfirmModal
        isOpen={state.isOpen}
        onClose={handleCancel}
        onConfirm={handleConfirm}
        title={state.title}
        message={state.message}
        confirmText={state.confirmText}
        cancelText={state.cancelText}
        variant={state.variant}
        loading={state.loading}
      />
    ),
  }
}

export { MetricCard, FilterChipBar, VirtualizedTable, SparklinePlus, StreakHero } from './Primitives'
export type { MetricCardProps, FilterChip, FilterChipBarProps, ColumnDef, VirtualizedTableProps, SparklinePlusProps, StreakHeroProps } from './Primitives'
