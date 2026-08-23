import { afterEach, describe, expect, it, vi } from 'vitest'

const createListMock = vi.hoisted(() => vi.fn())
const addListRowMock = vi.hoisted(() => vi.fn())
const saveImageBytesMock = vi.hoisted(() => vi.fn())
vi.mock('../shared/bindings', () => ({
  ConfigureService: { CreateList: createListMock, AddListRow: addListRowMock },
  AtlasService: { SaveImageBytes: saveImageBytesMock },
}))

import { ATLAS_TOOLS, cardTool, noteTool, areaTool, tableTool, imageTool, pencilTool } from './atlasTools'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

function kind(id: string): Kind {
  return { ID: id, Label: id, Description: '', Icon: '', Fields: [], LinkKindIDs: [] } as unknown as Kind
}

describe('ATLAS_TOOLS', () => {
  it('carries every registered tool in tray render order', () => {
    expect(ATLAS_TOOLS.map((t) => t.id)).toEqual(['card', 'note', 'area', 'table', 'image', 'pencil'])
  })

  it('scopes card/note/area to arm-then-click, table to pick-then-place, image to paste-or-drop, pencil to drag-to-draw', () => {
    const byID = Object.fromEntries(ATLAS_TOOLS.map((t) => [t.id, t.interaction]))
    expect(byID).toEqual({
      card: 'arm-then-click',
      note: 'arm-then-click',
      area: 'arm-then-click',
      table: 'pick-then-place',
      image: 'paste-or-drop',
      pencil: 'drag-to-draw',
    })
  })

  it('seats every tool in the quick tray', () => {
    expect(ATLAS_TOOLS.every((t) => t.tray === 'quick')).toBe(true)
  })

  it('carries styleDefaults only on the pencil tool', () => {
    const withDefaults = ATLAS_TOOLS.filter((t) => 'styleDefaults' in t && t.styleDefaults !== undefined)
    expect(withDefaults.map((t) => t.id)).toEqual(['pencil'])
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

describe('pencilTool.commit', () => {
  afterEach(() => {
    saveImageBytesMock.mockReset()
  })

  const stroke = Array.from({ length: 8 }, (_, i) => ({ x: i * 4, y: i * 4 }))

  it('writes the drawn stroke as an SVG mirror file, baking colour/size into the bytes', async () => {
    saveImageBytesMock.mockResolvedValue('/config/mill/atlas-captures/sketch-abc123.svg')
    const artifact = await pencilTool.commit({ points: stroke, color: '#da3633', size: 6 })
    expect(artifact).toMatchObject({ kind: 'pencil', title: 'Sketch', mirrorPath: '/config/mill/atlas-captures/sketch-abc123.svg' })
    expect(saveImageBytesMock).toHaveBeenCalledWith(expect.any(String), '.svg', 'Sketch')
    // The commit never re-reads atlasPencilStyleStore's ephemeral cache
    // -- colour/size travel through the call's own input, proving the
    // dual model's "baked on the object" half is independent of
    // whatever the session cache holds by the time this resolves.
    const svgBytes = atob(saveImageBytesMock.mock.calls[0][0])
    expect(svgBytes).toContain('fill="#da3633"')
  })

  it('returns null for a stray click, never touching SaveImageBytes', async () => {
    const artifact = await pencilTool.commit({ points: [{ x: 1, y: 1 }], color: '#1f6feb', size: 4 })
    expect(artifact).toBeNull()
    expect(saveImageBytesMock).not.toHaveBeenCalled()
  })
})
