import { useEffect, useRef } from 'react'
import { GridCellKind, type CustomCell, type CustomRenderer, type EditableGridCell, type GridCell } from '@glideapps/glide-data-grid'
import { type OptionColor, optionColor } from './projectionColors'
import type { GridColumn, GridRow } from './ListGrid'
import type { GridPalette } from './listGridGlideTheme'

// Field -> the adopted grid's cell kinds (ADR-0049): text and number
// are the library's own, boolean is its checkbox cell, and an
// options column is a CUSTOM cell drawn as the same colored pill the
// hand-rolled grid rendered, edited through a select overlay -- the
// library's own extension contract (customRenderers + provideEditor),
// never a rebuilt grid.

export interface OptionsCellData {
  readonly kind: 'mill-options'
  readonly value: string
  readonly options: readonly string[]
  readonly colors: readonly (string | undefined)[]
  readonly color: OptionColor | null
}

export type OptionsCell = CustomCell<OptionsCellData>

const isOptionsCell = (cell: CustomCell): cell is OptionsCell => (cell.data as { kind?: string })?.kind === 'mill-options'

export function cellForColumn(column: GridColumn | undefined, row: GridRow | undefined): GridCell {
  const value = row?.Values?.[column?.Key ?? ''] ?? ''
  if (!column) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false }
  if ((column.Options?.length ?? 0) > 0) {
    const data: OptionsCellData = {
      kind: 'mill-options', value, options: column.Options ?? [], colors: column.OptionColors ?? [],
      color: optionColor(column.Options, column.OptionColors, value),
    }
    return { kind: GridCellKind.Custom, data, copyData: value, allowOverlay: true }
  }
  if (column.Type === 'number') {
    const n = value === '' ? undefined : Number(value)
    return { kind: GridCellKind.Number, data: Number.isFinite(n) ? n : undefined, displayData: value, allowOverlay: true }
  }
  if (column.Type === 'boolean') {
    return { kind: GridCellKind.Boolean, data: value === 'true', allowOverlay: false }
  }
  return { kind: GridCellKind.Text, data: value, displayData: value, allowOverlay: true }
}

// The stored string for an edited cell of any kind.
export function valueFromEdited(cell: EditableGridCell): string {
  switch (cell.kind) {
    case GridCellKind.Text: return cell.data
    case GridCellKind.Number: return cell.data === undefined ? '' : String(cell.data)
    case GridCellKind.Boolean: return cell.data ? 'true' : 'false'
    case GridCellKind.Custom: return isOptionsCell(cell as CustomCell) ? (cell as OptionsCell).data.value : ''
    default: return ''
  }
}

// The select overlay for an options cell: a plain form control, the
// same Enter-commits / Escape-cancels the text overlay has. The grid
// owns commit timing; this only reports the choice.
function OptionsEditor({ value, onChange, onFinishedEditing }: {
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
      aria-label="Choose a value"
      style={{ font: 'inherit', minWidth: 120, padding: '4px 6px' }}
      onChange={(e) => pick(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onFinishedEditing() } }}
    >
      <option value="">{'—'}</option>
      {value.data.options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

// optionsRenderer draws the pill and supplies the editor. Pill
// colors come from the palette read at mount (listGridGlideTheme.ts).
export function optionsRenderer(palette: GridPalette): CustomRenderer<OptionsCell> {
  return {
    kind: GridCellKind.Custom,
    isMatch: isOptionsCell,
    draw: (args, cell) => {
      const { ctx, rect, theme } = args
      const { value, color } = cell.data
      if (!value) return
      const pill = color ? palette.pills[color] : { bg: theme.bgCellMedium, fg: theme.textDark }
      ctx.font = `600 11px ${theme.fontFamily}`
      const textWidth = ctx.measureText(value).width
      const h = 18
      const w = Math.min(textWidth + 14, rect.width - 8)
      const x = rect.x + theme.cellHorizontalPadding
      const y = rect.y + (rect.height - h) / 2
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, 9)
      ctx.fillStyle = pill.bg
      ctx.fill()
      ctx.fillStyle = pill.fg
      ctx.textBaseline = 'middle'
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
      ctx.fillText(value, x + 7, y + h / 2 + 1)
      ctx.restore()
    },
    provideEditor: () => ({
      editor: OptionsEditor,
      disablePadding: true,
      deletedValue: (cell) => ({ ...cell, data: { ...cell.data, value: '', color: null }, copyData: '' }),
    }),
    onPaste: (val, data) => {
      const choice = val.trim()
      if (choice !== '' && !data.options.includes(choice)) return undefined
      return { ...data, value: choice, color: optionColor([...data.options], [...data.colors] as string[], choice) }
    },
  }
}
