import { describe, expect, it } from 'vitest'
import type { BoardObject } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { nextTableTitle, tableTitlesOn } from './tableTool'

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

function tableObject(id: string, parentID: string, title: string | undefined): BoardObject {
  return { ID: id, Kind: 'table', ParentID: parentID, Payload: title === undefined ? {} : { title } } as unknown as BoardObject
}

// tableTitlesOn is the ONE scope every mint/rename-collision check
// reads (goal 0273 rule 2) -- per-board, table-only, blank titles
// dropped rather than colliding on ''.
describe('tableTitlesOn', () => {
  it('collects only table titles on the given board', () => {
    const objects = [
      tableObject('t1', 'board-a', 'Budget'),
      tableObject('t2', 'board-a', 'Roadmap'),
      tableObject('t3', 'board-b', 'Budget'),
      { ID: 'n1', Kind: 'note', ParentID: 'board-a', Payload: { title: 'Not a table' } } as unknown as BoardObject,
    ]
    expect(tableTitlesOn(objects, 'board-a')).toEqual(new Set(['Budget', 'Roadmap']))
    expect(tableTitlesOn(objects, 'board-b')).toEqual(new Set(['Budget']))
    expect(tableTitlesOn(objects, 'board-c')).toEqual(new Set())
  })

  it('drops a table with no mirrored title rather than colliding on blank', () => {
    const objects = [tableObject('t1', 'board-a', undefined)]
    expect(tableTitlesOn(objects, 'board-a')).toEqual(new Set())
  })
})
