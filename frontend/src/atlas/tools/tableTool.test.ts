import { describe, expect, it } from 'vitest'
import { nextTableTitle } from './tableTool'

// The name a new table is minted with (goal 0273) is shown by the
// placement ghost BEFORE the commit runs, so the rule has one home and
// both callers read it.
describe('nextTableTitle', () => {
  it('mints the bare name when nothing is called Table yet', () => {
    expect(nextTableTitle(new Set())).toBe('Table')
    expect(nextTableTitle(new Set(['Notes', 'Roadmap']))).toBe('Table')
  })

  it('walks past every taken name in order', () => {
    expect(nextTableTitle(new Set(['Table']))).toBe('Table 2')
    expect(nextTableTitle(new Set(['Table', 'Table 2']))).toBe('Table 3')
    expect(nextTableTitle(new Set(['Table', 'Table 2', 'Table 3']))).toBe('Table 4')
  })

  it('takes the first free name, not the one past the highest taken', () => {
    expect(nextTableTitle(new Set(['Table', 'Table 3']))).toBe('Table 2')
  })
})
