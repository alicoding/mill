import { describe, expect, it } from 'vitest'
import type { Rectangle } from '@glideapps/glide-data-grid'
import type { GridColumn } from './listGridTypes'
import { resolvePendingRename } from './listGridGlideRename'

const bounds: Rectangle = { x: 0, y: 0, width: 80, height: 32 }

const columns: GridColumn[] = [
  { Key: 'sku', Label: 'SKU', Type: 'text', Options: null, OptionColors: null },
]

const columnsWithFresh: GridColumn[] = [
  ...columns,
  { Key: 'fresh', Label: '', Type: 'text', Options: null, OptionColors: null },
]

describe('resolvePendingRename', () => {
  it('is not ready with no pending key', () => {
    expect(resolvePendingRename(columnsWithFresh, null, () => bounds)).toBeNull()
  })

  it('is not ready before the insert round-trips into columns', () => {
    // The backend hasn't reported the new column yet -- opening now
    // would rename the wrong (or a nonexistent) column.
    expect(resolvePendingRename(columns, 'fresh', () => bounds)).toBeNull()
  })

  it('is not ready once columns include the key but the grid has not reported a region for it', () => {
    // getColumnBounds mirrors getBounds returning a zero-width
    // rectangle before the grid's first layout pass.
    expect(resolvePendingRename(columnsWithFresh, 'fresh', () => undefined)).toBeNull()
  })

  it('resolves the column index and bounds once both signals land', () => {
    const resolved = resolvePendingRename(columnsWithFresh, 'fresh', (col) => (col === 1 ? bounds : undefined))
    expect(resolved).toEqual({ col: 1, bounds })
  })
})
