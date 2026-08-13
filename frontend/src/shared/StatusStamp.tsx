import type { ReactNode, MouseEventHandler } from 'react'
import styles from './StatusStamp.module.css'

export type StatusStampVariant = 'success' | 'caution' | 'danger' | 'neutral' | 'identity'

interface StatusStampProps {
  variant: StatusStampVariant
  children: ReactNode
  className?: string
  'data-testid'?: string
  title?: string
  onClick?: MouseEventHandler<HTMLSpanElement>
}

// Design wave 2's unified pill (goal 0001, audit §1) -- see
// StatusStamp.module.css's header comment for the full rationale and
// the StatusStamp-vs-Label (state-vs-category) split. A plain span,
// not a Primer Label wrapper: Label's own rounded-pill geometry is
// exactly what this replaces, so building on top of it would still
// carry its shape. `className` composes with the variant class
// (not overrides it) so call sites needing an extra positioning hook
// (BuildIdentityBadge's ribbon placement, ValidationPanel's own
// layout) keep working the same way they did with `<Label
// className=.../>`.
export function StatusStamp({ variant, children, className, title, onClick, ...rest }: StatusStampProps) {
  return (
    <span
      className={[styles.stamp, styles[variant], className].filter(Boolean).join(' ')}
      title={title}
      onClick={onClick}
      data-variant={variant}
      {...rest}
    >
      {children}
    </span>
  )
}
