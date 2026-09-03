import { describe, expect, it } from 'vitest'
import { parseCsvForEdit, serializeCellEdit, serializeCellEdits } from './atlasCsvQuickEdit'

// The quick-edit round-trip's fidelity table (goal 0239 S2): a single
// cell change writes the whole file back, and everything else about
// the file's structure survives -- delimiter, newline style, interior
// empty lines, the trailing-newline state, quoted fields that need
// quoting. Byte-layout minimalism (re-quoting only where needed) is
// the accepted, spreadsheet-standard exception.

function roundTrip(text: string, row: number, col: number, value: string): string {
  return serializeCellEdit(parseCsvForEdit(text), row, col, value)
}

describe('parseCsvForEdit', () => {
  it('hides empty source lines from display while keeping their source position', () => {
    const m = parseCsvForEdit('a,b\n\n1,2\n')
    expect(m.displayRows).toEqual([['a', 'b'], ['1', '2']])
    expect(m.sourceIndex).toEqual([0, 2])
  })

  it('detects delimiter and newline style from the source', () => {
    expect(parseCsvForEdit('a;b\n1;2\n').delimiter).toBe(';')
    expect(parseCsvForEdit('a,b\r\n1,2\r\n').newline).toBe('\r\n')
    expect(parseCsvForEdit('a,b\n1,2\n').newline).toBe('\n')
  })
})

describe('serializeCellEdit', () => {
  it('changes exactly one cell, preserving a trailing newline', () => {
    expect(roundTrip('a,b\n1,2\n', 1, 1, '3')).toBe('a,b\n1,3\n')
  })

  it('preserves the absence of a trailing newline', () => {
    expect(roundTrip('a,b\n1,2', 1, 1, '3')).toBe('a,b\n1,3')
  })

  it('preserves interior empty lines and edits the right source row past them', () => {
    expect(roundTrip('a,b\n\n1,2\n', 1, 0, '9')).toBe('a,b\n\n9,2\n')
  })

  it('preserves a semicolon delimiter and CRLF newlines', () => {
    expect(roundTrip('a;b\r\n1;2\r\n', 1, 0, 'x')).toBe('a;b\r\nx;2\r\n')
  })

  it('quotes a value that needs quoting, and keeps already-quoted commas intact', () => {
    expect(roundTrip('a,b\n"1,5",2\n', 1, 1, 'x,y')).toBe('a,b\n"1,5","x,y"\n')
  })

  it('edits the header row like any other row', () => {
    expect(roundTrip('a,b\n1,2\n', 0, 0, 'renamed')).toBe('renamed,b\n1,2\n')
  })

  it('pads a short row only as far as the edited column', () => {
    expect(roundTrip('a,b,c\n1\n', 1, 2, 'z')).toBe('a,b,c\n1,,z\n')
  })

  it('never mutates the model it serializes from', () => {
    const m = parseCsvForEdit('a,b\n1,2\n')
    serializeCellEdit(m, 1, 1, '3')
    expect(m.fullRows[1]).toEqual(['1', '2'])
  })
})

describe('serializeCellEdits (goal 0295 S2b)', () => {
  it('applies several held cells in one write, padding short rows per edit', () => {
    const model = parseCsvForEdit('a,b\n1,2\n3\n')
    const text = serializeCellEdits(model, [
      { row: 1, col: 1, value: 'two' },
      { row: 2, col: 1, value: 'four' },
      { row: 0, col: 0, value: 'A' },
    ])
    expect(text).toBe('A,b\n1,two\n3,four\n')
  })
})
