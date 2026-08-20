import { Label } from '@primer/react'
import { optionColor } from './projectionColors'
import type { GridColumn } from './ListGrid'

// cellContent renders an options value as its colored pill; anything
// else (plain text, or a value outside the declared options) stays
// text.
export function cellContent(c: GridColumn, value: string) {
  if (!value || (c.Options?.length ?? 0) === 0) return value
  const color = optionColor(c.Options, c.OptionColors, value)
  if (!color) return value
  return <Label size="small" variant={color} data-testid="atlas-projection-pill">{value}</Label>
}

// The pills density tints each row by its FIRST options column's
// value color (the status-board reading: a row IS its state).
export function rowTintStyle(columns: GridColumn[], values: { [key: string]: string | undefined }) {
  const statusCol = columns.find((c) => (c.Options?.length ?? 0) > 0)
  if (!statusCol) return undefined
  const color = optionColor(statusCol.Options, statusCol.OptionColors, values[statusCol.Key] ?? '')
  if (!color) return undefined
  return { background: `var(--bgColor-${color}-muted)` }
}

