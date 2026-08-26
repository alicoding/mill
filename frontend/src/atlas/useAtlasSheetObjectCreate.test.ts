import { describe, expect, it } from 'vitest'
import { isSheetPath } from './useAtlasSheetObjectCreate'

describe('isSheetPath (goal 0232 S2)', () => {
  it('recognizes .xlsx/.csv regardless of case', () => {
    expect(isSheetPath('/tmp/book.xlsx')).toBe(true)
    expect(isSheetPath('/tmp/BOOK.XLSX')).toBe(true)
    expect(isSheetPath('/tmp/rows.csv')).toBe(true)
    expect(isSheetPath('/tmp/ROWS.CSV')).toBe(true)
  })

  it('is false for an unrelated extension', () => {
    expect(isSheetPath('/tmp/notes.md')).toBe(false)
    expect(isSheetPath('/tmp/photo.png')).toBe(false)
    expect(isSheetPath('/tmp/plan.drawio')).toBe(false)
  })

  it('is false for a directory-less bare filename with no extension', () => {
    expect(isSheetPath('/tmp/README')).toBe(false)
  })
})
