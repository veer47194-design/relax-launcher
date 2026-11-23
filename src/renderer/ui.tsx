import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from './api'

export { cx }

/* ------------------------------- Иконки ------------------------------- */

const ICONS = {
  home: <><path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10.5Z" /></>,
  layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
  box: <><path d="M21 8v8l-9 5-9-5V8l9-5 9 5Z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /></>,
  puzzle: <><path d="M19.4 14.6a2 2 0 0 1 0 2.8l-2 2a2 2 0 0 1-2.8 0l-.9-.9a1.5 1.5 0 0 0-2.1 0l-.9.9a2 2 0 0 1-2.8 0l-2-2a2 2 0 0 1 0-2.8l.9-.9a1.5 1.5 0 0 0 0-2.1l-.9-.9a2 2 0 0 1 0-2.8l2-2a2 2 0 0 1 2.8 0l.9.9a1.5 1.5 0 0 0 2.1 0l.9-.9a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8l-.9.9a1.5 1.5 0 0 0 0 2.1l.9.9Z" /></>,
  package: <><path d="M21 8v8l-9 5-9-5V8l9-5 9 5Z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" /><path d="m7.5 5.5 9 5" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  settings: <><path d="M4 6h7M15 6h5M4 12h3M11 12h9M4 18h9M17 18h3" /><circle cx="13" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="15" cy="18" r="2" /></>,
  terminal: <><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></>,
  play: <path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" /></>,
  stop: <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor" stroke="none" />,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" /></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 21h14" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>,
  cpu: <><rect x="7" y="7" width="10" height="10" rx="2" /><rect x="10" y="10" width="4" height="4" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
  minimize: <path d="M5 12h14" />,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  restore: <><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 14v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
  sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
  shield: <><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  alert: <><path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5M12 18h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  leaf: <><path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14Z" /><path d="M5 19c3-3 6-5 9-6" /></>,
  memory: <><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M7 7v10M12 7v10M17 7v10" /></>,
  wifi: <><path d="M5 12.5a10 10 0 0 1 14 0M8 16a6 6 0 0 1 8 0" /><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" /></>,
  arrowRight: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />,
  filter: <path d="M4 5h16l-6 8v6l-4 2v-8L4 5Z" />,
  grid2: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>,
  camera: <><path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13.5" r="3.6" /></>,
} as const

export type IconName = keyof typeof ICONS

/** Фирменный знак Relax: монограмма R с волной и точкой-искрой. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      className={className ? `logo-mark ${className}` : 'logo-mark'}
      aria-hidden="true"
    >
      <path
        d="M15.5 35V13.5h10.2a6.4 6.4 0 0 1 0 12.8H19"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M25.5 26.5 34 35"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="35.5" cy="12.5" r="2.7" fill="currentColor" />
      <path
        d="M12 40.5c4.2 2.6 7.8-2.6 12 0s7.8-2.6 12 0"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  )
}

export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.8,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

/* ------------------------------- Кнопки ------------------------------- */

type ButtonVariant = 'primary' | 'soft' | 'ghost' | 'danger' | 'success' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  loading?: boolean
  block?: boolean
}

export function Button({
  variant = 'soft',
  size = 'md',
  icon,
  loading,
  block,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 17} /> : null}
      {children}
    </button>
  )
}

export function IconButton({
  icon,
  title,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; title: string }) {
  return (
    <button className={cx('icon-btn', className)} title={title} aria-label={title} {...rest}>
      <Icon name={icon} size={17} />
    </button>
  )
}

/* ------------------------------- Прочее ------------------------------- */

export function Spinner({ size = 18 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'green' | 'amber' | 'red' | 'blue'
  className?: string
}) {
  return <span className={cx('badge', `badge-${tone}`, className)}>{children}</span>
}

export function Card({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Field({
  label,
  hint,
  children,
  inline,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  inline?: boolean
}) {
  return (
    <div className={cx('field', inline && 'field-inline')}>
      <div className="field-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="field-control">{children}</div>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx('switch', checked && 'switch-on')}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="switch-knob" />
    </button>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <input
      type="range"
      className="slider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
    />
  )
}

export function Select({
  value,
  onChange,
  children,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <div className={cx('select-wrap', className)}>
      <select className="select" value={value} onChange={onChange} {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" size={15} />
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T
  onChange: (value: T) => void
  items: { value: T; label: string; icon?: IconName; badge?: number }[]
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          className={cx('tab', value === item.value && 'tab-active')}
          onClick={() => onChange(item.value)}
        >
          {item.icon && <Icon name={item.icon} size={16} />}
          {item.label}
          {item.badge != null && item.badge > 0 && <span className="tab-badge">{item.badge}</span>}
        </button>
      ))}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div className="search">
      <Icon name="search" size={17} />
      <input
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {value && (
        <button className="search-clear" onClick={() => onChange('')} aria-label="Очистить">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  icon = 'box',
  title,
  text,
  action,
}: {
  icon?: IconName
  title: string
  text?: string
  action?: React.ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 560,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon="close" title="Закрыть" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmButton({
  onConfirm,
  children,
  confirmText = 'Точно удалить?',
  icon = 'trash',
  size = 'md',
}: {
  onConfirm: () => void
  children: React.ReactNode
  confirmText?: string
  icon?: IconName
  size?: ButtonSize
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(timer)
  }, [armed])
  return (
    <Button
      variant={armed ? 'danger' : 'ghost'}
      size={size}
      icon={armed ? 'alert' : icon}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
        }
      }}
    >
      {armed ? confirmText : children}
    </Button>
  )
}

export function Head({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [name])
  const style = { width: size, height: size }
  if (failed) {
    return (
      <span className={cx('head head-fallback', className)} style={style}>
        {name.slice(0, 2).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      className={cx('head', className)}
      style={style}
      src={`https://mc-heads.net/avatar/${encodeURIComponent(name)}/${Math.max(32, size * 2)}`}
      alt={name}
      onError={() => setFailed(true)}
      draggable={false}
    />
  )
}

export function RemoteIcon({
  src,
  fallback,
  size = 48,
  radius = 12,
}: {
  src?: string | null
  fallback: string
  size?: number
  radius?: number
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) {
    return (
      <span
        className="remote-icon remote-icon-fallback"
        style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.42 }}
      >
        {fallback.slice(0, 1).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      className="remote-icon"
      src={src}
      alt=""
      style={{ width: size, height: size, borderRadius: radius }}
      onError={() => setFailed(true)}
      draggable={false}
    />
  )
}

export function SpinnerBlock({ text }: { text?: string }) {
  return (
    <div className="spinner-block">
      <Spinner size={22} />
      {text && <span>{text}</span>}
    </div>
  )
}

/** Плавно подгружает ещё при прокрутке вниз. */
export function useInfiniteSentinel(onMore: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!enabled || !ref.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onMore()
    }, { rootMargin: '240px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [enabled, onMore])
  return ref
}
