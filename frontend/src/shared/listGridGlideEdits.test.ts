import { describe, expect, it } from 'vitest'
import { GridCellKind, type EditListItem } from '@glideapps/glide-data-grid'
import type { GridColumn, GridRow } from './listGridTypes'
import { editsByRow, pasteOverflowPatches } from './listGridGlideEdits'

const columns: GridColumn[] = [
  { Key: 'sku', Label: 'SKU', Type: 'text', Options: null, OptionColors: null },
  { Key: 'qty', Label: 'Qty', Type: 'text', Options: null, OptionColors: null },
]

const rows: GridRow[] = [
  { ID: 'r1', Status: 'active', Values: { sku: 'A', qty: '1' } },
]

function textEdit(text: string): EditListItem['value'] {
  return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: true }
}

describe('editsByRow', () => {
  it('collapses a multi-cell batch into one patch per row', () => {
    const items: EditListItem[] = [
      { location: [0, 0], value: textEdit('B') },
      { location: [1, 0], value: textEdit('2') },
    ]
    const byRow = editsByRow(columns, rows, items)
    expect(byRow.size).toBe(1)
    expect(byRow.get(0)).toEqual({ sku: 'B', qty: '2' })
  })

  it('drops an edit whose row or column no longer exists', () => {
    const items: EditListItem[] = [
      { location: [5, 0], value: textEdit('x') },
      { location: [0, 9], value: textEdit('y') },
    ]
    expect(editsByRow(columns, rows, items).size).toBe(0)
  })
})

describe('pasteOverflowPatches', () => {
  it('is empty when the paste fits inside the stored rows', () => {
    expect(pasteOverflowPatches(columns, rows, 0, 0, [['A', '1']])).toEqual([])
  })

  it('maps every row past the end into a column-keyed patch, in order', () => {
    const patches = pasteOverflowPatches(columns, rows, 0, 1, [['B', '2'], ['C', '3']])
    expect(patches).toEqual([{ sku: 'B', qty: '2' }, { sku: 'C', qty: '3' }])
  })

  it('clips a paste column past the last one instead of growing the schema', () => {
    // targetCol 1 ("qty") + i 1 addresses column index 2, which does
    // not exist -- that cell is dropped, never a new column.
    const patches = pasteOverflowPatches(columns, rows, 1, 1, [['x', 'y']])
    expect(patches).toEqual([{ qty: 'x' }])
  })
})
