import { afterEach, describe, expect, it, vi } from 'vitest'

const createListMock = vi.hoisted(() => vi.fn())
const addListRowMock = vi.hoisted(() => vi.fn())
const saveImageBytesMock = vi.hoisted(() => vi.fn())
vi.mock('../shared/bindings', () => ({
  ConfigureService: { CreateList: createListMock, AddListRow: addListRowMock },
  AtlasService: { SaveImageBytes: saveImageBytesMock },
}))

import { ATLAS_TOOLS, cardTool, noteTool, areaTool, tableTool, imageTool } from './atlasTools'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

function kind(id: string): Kind {
  return { ID: id, Label: id, Description: '', Icon: '', Fields: [], LinkKindIDs: [] } as unknown as Kind
}

describe('ATLAS_TOOLS', () => {
  it('carries every registered tool in tray render order', () => {
    expect(ATLAS_TOOLS.map((t) => t.id)).toEqual(['card', 'note', 'area', 'table', 'image'])
  })

  // area moved from 'arm-then-click' to 'drag-to-draw' (goal 0215 S2):
  // its own runtime gesture was always a marquee drag, never a single
  // click -- the classification now matches the code, not the other
  // way around.
  it('scopes card/note to arm-then-click, table to pick-then-place, image to paste-or-drop, area to drag-to-draw', () => {
    const byID = Object.fromEntries(ATLAS_TOOLS.map((t) => [t.id, t.interaction]))
    expect(byID).toEqual({
      card: 'arm-then-click',
      note: 'arm-then-click',
      area: 'drag-to-draw',
      table: 'pick-then-place',
      image: 'paste-or-drop',
    })
  })

  it('seats every tool in the quick tray', () => {
    expect(ATLAS_TOOLS.every((t) => t.tray === 'quick')).toBe(true)
  })

  it('declares styleFields as a real array on every noun (goal 0209, never undefined) -- no compiled-in tool has a style surface since the drawing tools moved to the Drawing plugin (goal 0252)', () => {
    expect(ATLAS_TOOLS.every((t) => Array.isArray(t.styleFields))).toBe(true)
    expect(ATLAS_TOOLS.filter((t) => t.styleFields.length > 0)).toEqual([])
  })

  it('never repeats a field key within one noun\'s own styleFields', () => {
    for (const tool of ATLAS_TOOLS) {
      const keys = tool.styleFields.map((f) => f.key)
      expect(keys, `${tool.id}'s styleFields repeats a key`).toEqual([...new Set(keys)])
    }
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
  // Regression (goal 0226): the note's text is markdown SOURCE -- a
  // trim here used to silently drop a leading/trailing blank line the
  // author typed on purpose, breaking the edit/display round trip.
  it('preserves the note text exactly, no whitespace normalization', () => {
    expect(noteTool.commit({ text: '  hello  ' })).toEqual({ kind: 'note', text: '  hello  ' })
  })

  it('preserves an already-empty note (placement itself is the capture)', () => {
    expect(noteTool.commit({ text: '' })).toEqual({ kind: 'note', text: '' })
  })
})

describe('areaTool.commit', () => {
  it('carries the enclosed membership through unchanged', () => {
    const artifact = areaTool.commit({ kindID: 'a', title: 'Area', enclosedCardIDs: ['c1'], enclosedNoteIDs: ['n1'], enclosedObjectIDs: ['o1'] })
    expect(artifact).toEqual({ kind: 'area', kindID: 'a', title: 'Area', enclosedCardIDs: ['c1'], enclosedNoteIDs: ['n1'], enclosedObjectIDs: ['o1'] })
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

describe('imageTool.commit', () => {
  afterEach(() => {
    saveImageBytesMock.mockReset()
  })

  it('normalizes a typed path into the mirror artifact without touching the backend', async () => {
    const artifact = await imageTool.commit({ path: 'file:///Users/me/My%20Photo.png' })
    expect(artifact).toEqual({ kind: 'image', title: 'My Photo', mirrorPath: '/Users/me/My Photo.png' })
    expect(saveImageBytesMock).not.toHaveBeenCalled()
  })

  it('writes a pasted file through SaveImageBytes and uses the returned path as the mirror', async () => {
    saveImageBytesMock.mockResolvedValue('/config/mill/atlas-captures/pasted-image-abc123.png')
    const file = new File(['bytes'], 'clipboard.png', { type: 'image/png' })
    const artifact = await imageTool.commit({ file, title: 'Pasted image' })
    expect(artifact).toEqual({ kind: 'image', title: 'Pasted image', mirrorPath: '/config/mill/atlas-captures/pasted-image-abc123.png' })
    expect(saveImageBytesMock).toHaveBeenCalledWith(expect.any(String), '.png', 'Pasted image')
  })

  it('rejects a pasted file whose mime type is not a recognized image extension', async () => {
    const file = new File(['bytes'], 'clipboard.tiff', { type: 'image/tiff' })
    await expect(imageTool.commit({ file, title: 'Pasted image' })).rejects.toThrow(/unsupported/)
    expect(saveImageBytesMock).not.toHaveBeenCalled()
  })
})

