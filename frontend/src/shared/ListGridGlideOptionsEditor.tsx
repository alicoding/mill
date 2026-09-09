import { useEffect, useRef } from 'react'
import { copy as copyText } from './copy'
import { optionColor } from './projectionColors'
import type { OptionsCell } from './listGridGlideCells'

// The select overlay for an options cell: a plain form control, the
// same Enter-commits / Escape-cancels the text overlay has. The grid
// owns commit timing; this only reports the choice. Its own file (goal
// 0419 S1b): listGridGlideCells.tsx's exports are cell-shape helpers,
// not components, so this editor can't share that file without
// breaking Fast Refresh's own file-shape check.
export function OptionsEditor({ value, onChange, onFinishedEditing }: {
  value: OptionsCell
  onChange: (next: OptionsCell) => void
  onFinishedEditing: (next?: OptionsCell) => void
}) {
  const ref = useRef<HTMLSelectElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const pick = (choice: string) => {
    const next: OptionsCell = { ...value, data: { ...value.data, value: choice, color: optionColor([...value.data.options], [...value.data.colors] as string[], choice) }, copyData: choice }
    onChange(next)
    onFinishedEditing(next)
  }
  return (
    <select
      ref={ref}
      value={value.data.value}
      data-testid="atlas-projection-cell-select"
      aria-label={copyText('listGrid.chooseValueAriaLabel')}
      style={{ font: 'inherit', minWidth: 120, padding: '4px 6px' }}
      onChange={(e) => pick(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onFinishedEditing() } }}
    >
      <option value="">{'—'}</option>
      {value.data.options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
