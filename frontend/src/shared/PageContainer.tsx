import type { ReactNode } from 'react'
import styles from './PageContainer.module.css'

// Replaces ListCard.module.css's old .page/.formPage classes, which were
// hand-copied as raw classNames into ~12 view files with no single owner
// for width/inset (docs/SPEC.md's "Window/scroll layout foundation"
// Update). One component, one place to change if a variant's width ever
// needs to move.
type PageContainerVariant = 'wide' | 'narrow' | 'full'

const VARIANT_CLASS: Record<PageContainerVariant, string> = {
  wide: styles.wide,
  narrow: styles.narrow,
  full: styles.full,
}

interface PageContainerProps {
  variant?: PageContainerVariant
  className?: string
  'data-testid'?: string
  children: ReactNode
}

export default function PageContainer({ variant = 'wide', className, children, ...rest }: PageContainerProps) {
  const classes = className ? `${VARIANT_CLASS[variant]} ${className}` : VARIANT_CLASS[variant]
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  )
}
