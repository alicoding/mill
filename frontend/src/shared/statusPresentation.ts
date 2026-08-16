import type { StatusStampVariant } from './StatusStamp'

// The capability-status visual mapping (LOCKED/OPEN/PARKED -> Label
// variant / dot color), shared by PlaceholderView and the sidebar
// nav's status dot -- its own file so store.ts stays a store, not a
// grab-bag (and under the 500-line convention).
const STATUS_VARIANT: Record<string, StatusStampVariant> = {
  LOCKED: 'success',
  OPEN: 'caution',
  PARKED: 'neutral',
}

export function statusVariant(status: string): StatusStampVariant {
  return STATUS_VARIANT[status] ?? 'neutral'
}

const STATUS_DOT_COLOR: Record<string, string> = {
  LOCKED: 'var(--fgColor-success)',
  OPEN: 'var(--fgColor-attention)',
  PARKED: 'var(--fgColor-muted)',
}

export function statusDotColor(status: string): string {
  return STATUS_DOT_COLOR[status] ?? 'var(--fgColor-muted)'
}
