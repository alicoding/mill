import { describe, expect, it } from 'vitest'
import { sheetTruncationNote, truncateSheetRows } from './atlasSheetTruncate'

function grid(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `r${r}c${c}`))
}

describe('truncateSheetRows (goal 0232 S2)', () => {
  it('passes a small sheet through unchanged', () => {
    const result = truncateSheetRows(grid(3, 4))
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toHaveLength(4)
    expect(result.totalRows).toBe(3)
    expect(result.totalCols).toBe(4)
    expect(result.truncatedRows).toBe(false)
    expect(result.truncatedCols).toBe(false)
  })

  it('caps rows at maxRows and reports the real total', () => {
    const result = truncateSheetRows(grid(60, 3), 50, 12)
    expect(result.rows).toHaveLength(50)
    expect(result.totalRows).toBe(60)
    expect(result.truncatedRows).toBe(true)
    expect(result.truncatedCols).toBe(false)
  })

  it('caps columns at maxCols and reports the real total', () => {
    const result = truncateSheetRows(grid(3, 20), 50, 12)
    expect(result.rows[0]).toHaveLength(12)
    expect(result.totalCols).toBe(20)
    expect(result.truncatedRows).toBe(false)
    expect(result.truncatedCols).toBe(true)
  })

  it('caps both dimensions at once', () => {
    const result = truncateSheetRows(grid(60, 20), 50, 12)
    expect(result.rows).toHaveLength(50)
    expect(result.rows[0]).toHaveLength(12)
    expect(result.truncatedRows).toBe(true)
    expect(result.truncatedCols).toBe(true)
  })

  it('measures totalCols honestly against a ragged sheet, not the first row', () => {
    const ragged = [['a'], ['b', 'c', 'd']]
    const result = truncateSheetRows(ragged, 50, 12)
    expect(result.totalCols).toBe(3)
  })

  it('handles an empty sheet without throwing', () => {
    const result = truncateSheetRows([])
    expect(result.rows).toEqual([])
    expect(result.totalRows).toBe(0)
    expect(result.totalCols).toBe(0)
    expect(result.truncatedRows).toBe(false)
    expect(result.truncatedCols).toBe(false)
  })
})

describe('sheetTruncationNote (goal 0232 S2)', () => {
  it('returns null when nothing was truncated', () => {
    expect(sheetTruncationNote(truncateSheetRows(grid(3, 4)))).toBeNull()
  })

  it('names rows only when only rows were truncated', () => {
    const note = sheetTruncationNote(truncateSheetRows(grid(60, 3), 50, 12), 50, 12)
    expect(note).toEqual({ key: 'sheet.truncatedRowsOnly', values: { shownRows: 50, totalRows: 60 } })
  })

  it('names columns only when only columns were truncated', () => {
    const note = sheetTruncationNote(truncateSheetRows(grid(3, 20), 50, 12), 50, 12)
    expect(note).toEqual({ key: 'sheet.truncatedColsOnly', values: { shownCols: 12, totalCols: 20 } })
  })

  it('names both, as one sentence-shaped key, when both were truncated', () => {
    const note = sheetTruncationNote(truncateSheetRows(grid(60, 20), 50, 12), 50, 12)
    expect(note).toEqual({
      key: 'sheet.truncatedBoth',
      values: { shownRows: 50, totalRows: 60, shownCols: 12, totalCols: 20 },
    })
  })
})
