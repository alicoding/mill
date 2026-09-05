import { describe, expect, it } from 'vitest'
import { cellText, tableTsv } from './outputTable'
import { tableFrom } from './outputShape'

describe('what a table cell shows', () => {
  it('keeps a nested value as JSON rather than flattening it away', () => {
    expect(cellText({ a: 1 })).toBe('{"a":1}')
    expect(cellText([1, 2])).toBe('[1,2]')
  })

  it('shows a string bare and a number as itself', () => {
    expect(cellText('hello')).toBe('hello')
    expect(cellText(7)).toBe('7')
    expect(cellText(false)).toBe('false')
  })

  it('leaves an absent value empty rather than printing null', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
  })
})

describe('what Copy puts on the clipboard from a table', () => {
  it('is tab-separated with a header row, so a spreadsheet takes it as cells', () => {
    const data = tableFrom([{ name: 'alpha', status: 'ok' }, { name: 'beta', status: 'failed' }])!
    expect(tableTsv(data)).toBe('name\tstatus\nalpha\tok\nbeta\tfailed')
  })

  it('flattens a tab or newline inside a value, which would otherwise break the grid', () => {
    const data = tableFrom([{ note: 'one\ttwo\nthree' }])!
    expect(tableTsv(data)).toBe('note\none two three')
  })

  it('leaves a missing column empty in the rows that lack it', () => {
    const data = tableFrom([{ a: 1, b: 2 }, { a: 3 }])!
    expect(tableTsv(data)).toBe('a\tb\n1\t2\n3\t')
  })
})
