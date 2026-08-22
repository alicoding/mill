import { afterEach, describe, expect, it, vi } from 'vitest'

const createListMock = vi.hoisted(() => vi.fn())
const addListRowMock = vi.hoisted(() => vi.fn())
vi.mock('../shared/bindings', () => ({
  ConfigureService: { CreateList: createListMock, AddListRow: addListRowMock },
}))

import { ATLAS_TOOLS, cardTool, noteTool, areaTool, tableTool } from './atlasTools'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

function kind(id: string): Kind {
  return { ID: id, Label: id, Description: '', Icon: '', Fields: [], LinkKindIDs: [] } as unknown as Kind
}

describe('ATLAS_TOOLS', () => {
  it('carries every registered tool in tray render order', () => {
    expect(ATLAS_TOOLS.map((t) => t.id)).toEqual(['card', 'note', 'area', 'table'])
  })

  it('scopes card/note/area to arm-then-click and table to pick-then-place', () => {
    const byID = Object.fromEntries(ATLAS_TOOLS.map((t) => [t.id, t.interaction]))
    expect(byID).toEqual({
      card: 'arm-then-click',
      note: 'arm-then-click',
      area: 'arm-then-click',
      table: 'pick-then-place',
    })
  })

  it('seats every tool in the quick tray', () => {
    expect(ATLAS_TOOLS.every((t) => t.tray === 'quick')).toBe(true)
  })
})

describe('cardTool.commit', () => {
  it('shapes an explicit kind/title/note into the card artifact unchanged', () => {
    const artifact = cardTool.commit({ kinds: [kind('a')], kindID: 'a', title: 'My Card', note: 'a note' })
    expect(artifact).toEqual({ kind: 'card', kindID: 'a', title: 'My Card', note: 'a note' })
  })

  it('defaults an untitled card when no title is supplied', () => {
    const artifact = cardTool.commit({ kinds: [kind('a')], kindID: 'a' })
    expect(artifact.title).toBe('Untitled')
    expect(artifact.note).toBe('')
  })
})

describe('noteTool.commit', () => {
  it('trims the note text', () => {
    expect(noteTool.commit({ text: '  hello  ' })).toEqual({ kind: 'note', text: 'hello' })
  })

  it('preserves an already-empty note (placement itself is the capture)', () => {
    expect(noteTool.commit({ text: '' })).toEqual({ kind: 'note', text: '' })
  })
})

describe('areaTool.commit', () => {
  it('carries the enclosed membership through unchanged', () => {
    const artifact = areaTool.commit({ kindID: 'a', title: 'Area', enclosedCardIDs: ['c1'], enclosedNoteIDs: ['n1'] })
    expect(artifact).toEqual({ kind: 'area', kindID: 'a', title: 'Area', enclosedCardIDs: ['c1'], enclosedNoteIDs: ['n1'] })
  })
})

describe('tableTool.commit', () => {
  afterEach(() => {
    createListMock.mockReset()
    addListRowMock.mockReset()
  })

  it('mints the backing List, uniquifying the title against existing cards', async () => {
    createListMock.mockResolvedValue({ ID: 'list-1' })
    const artifact = await tableTool.commit({ cols: 2, rowCount: 1, existingTitles: new Set(['Table']) })
    expect(artifact).toEqual({ kind: 'table', title: 'Table 2', listID: 'list-1' })
    expect(createListMock).toHaveBeenCalledWith('Table 2', '', expect.arrayContaining([
      expect.objectContaining({ Key: 'column-1', Label: 'Column 1' }),
      expect.objectContaining({ Key: 'column-2', Label: 'Column 2' }),
    ]))
    expect(addListRowMock).toHaveBeenCalledTimes(1)
    expect(addListRowMock).toHaveBeenCalledWith('list-1', {})
  })

  it('keeps the default title when nothing collides', async () => {
    createListMock.mockResolvedValue({ ID: 'list-2' })
    const artifact = await tableTool.commit({ cols: 0, rowCount: 0, existingTitles: new Set() })
    expect(artifact.title).toBe('Table')
    expect(addListRowMock).not.toHaveBeenCalled()
  })
})
