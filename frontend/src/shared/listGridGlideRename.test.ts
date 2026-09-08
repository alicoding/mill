import { describe, expect, it } from 'vitest'
import type { Rectangle } from '@glideapps/glide-data-grid'
import type { GridColumn } from './listGridTypes'
import { resolvePendingRename } from './listGridGlideRename'

const oneColVisible: Rectangle = { x: 0, y: 0, width: 1, height: 10 }
const secondColVisible: Rectangle = { x: 1, y: 0, width: 1, height: 10 }

const columns: GridColumn[] = [
  { Key: 'sku', Label: 'SKU', Type: 'text', Options: null, OptionColors: null },
]

const columnsWithFresh: GridColumn[] = [
  ...columns,
  { Key: 'fresh', Label: '', Type: 'text', Options: null, OptionColors: null },
]

describe('resolvePendingRename', () => {
  it('is not ready with no pending key', () => {
    expect(resolvePendingRename(columnsWithFresh, null, secondColVisible)).toBeNull()
  })

  it('is not ready before the insert round-trips into columns', () => {
    // The backend hasn't reported the new column yet -- opening now
    // would rename the wrong (or a nonexistent) column.
    expect(resolvePendingRename(columns, 'fresh', oneColVisible)).toBeNull()
  })

  it('is not ready once columns include the key but the grid has never reported a region', () => {
    // No onVisibleRegionChanged has landed yet -- a bounds probe is
    // never made to decide readiness instead.
    expect(resolvePendingRename(columnsWithFresh, 'fresh', null)).toBeNull()
  })

  it('is not ready when the reported range does not yet include the column', () => {
    expect(resolvePendingRename(columnsWithFresh, 'fresh', oneColVisible)).toBeNull()
  })

  it('resolves the column index once the reported range includes it', () => {
    expect(resolvePendingRename(columnsWithFresh, 'fresh', secondColVisible)).toBe(1)
  })

  it('zero-to-one transition: the pending key set before the grid exists resolves on the first region report after mount', () => {
    // The list starts empty (no DataEditor mounted, so no region has
    // ever been reported): the intent is set first, exactly as it is
    // when insertColumnAt's own round trip resolves before the fresh
    // grid's first resize settles.
    const freshColumn: GridColumn[] = [{ Key: 'fresh', Label: '', Type: 'text', Options: null, OptionColors: null }]
    expect(resolvePendingRename(freshColumn, 'fresh', null)).toBeNull()
    // The grid mounts (DataEditor renders for the first time) and its
    // first onVisibleRegionChanged reports the single column visible.
    const firstReport: Rectangle = { x: 0, y: 0, width: 1, height: 10 }
    expect(resolvePendingRename(freshColumn, 'fresh', firstReport)).toBe(0)
  })

  it('zero-to-one transition, reverse order: the grid mounts and reports before the pending key arrives', () => {
    // The grid's own local resize settles before the backend round
    // trip resolves the insert -- resolvePendingRename still refuses
    // until the key itself lands, using the LAST reported range once
    // it does (the caller re-evaluates on the key's own arrival).
    const freshColumn: GridColumn[] = [{ Key: 'fresh', Label: '', Type: 'text', Options: null, OptionColors: null }]
    const firstReport: Rectangle = { x: 0, y: 0, width: 1, height: 10 }
    expect(resolvePendingRename(freshColumn, null, firstReport)).toBeNull()
    expect(resolvePendingRename(freshColumn, 'fresh', firstReport)).toBe(0)
  })
})
