import { afterEach, describe, expect, it, vi } from 'vitest'

const createListMock = vi.hoisted(() => vi.fn())
const addListRowMock = vi.hoisted(() => vi.fn())
const saveImageBytesMock = vi.hoisted(() => vi.fn())
vi.mock('../shared/bindings', () => ({
  ConfigureService: { CreateList: createListMock, AddListRow: addListRowMock },
  AtlasService: { SaveImageBytes: saveImageBytesMock },
}))

import { ATLAS_TOOLS, cardTool, noteTool, areaTool, tableTool, imageTool, pencilTool, eraserTool, laserTool, shapeTool } from './atlasTools'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

function kind(id: string): Kind {
  return { ID: id, Label: id, Description: '', Icon: '', Fields: [], LinkKindIDs: [] } as unknown as Kind
}

describe('ATLAS_TOOLS', () => {
  it('carries every registered tool in tray render order', () => {
    expect(ATLAS_TOOLS.map((t) => t.id)).toEqual(['card', 'note', 'area', 'table', 'image', 'pencil', 'eraser', 'laser', 'shape'])
  })

  // area moved from 'arm-then-click' to 'drag-to-draw' (goal 0215 S2):
  // its own runtime gesture was always a marquee drag, never a single
  // click -- the classification now matches the code, not the other
  // way around.
  it('scopes card/note to arm-then-click, table to pick-then-place, image to paste-or-drop, area+pencil+shape to drag-to-draw, eraser to drag-to-erase, laser to ephemeral-drag', () => {
    const byID = Object.fromEntries(ATLAS_TOOLS.map((t) => [t.id, t.interaction]))
    expect(byID).toEqual({
      card: 'arm-then-click',
      note: 'arm-then-click',
      area: 'drag-to-draw',
      table: 'pick-then-place',
      image: 'paste-or-drop',
      pencil: 'drag-to-draw',
      eraser: 'drag-to-erase',
      laser: 'ephemeral-drag',
      shape: 'drag-to-draw',
    })
  })

  it('seats every tool in the quick tray', () => {
    expect(ATLAS_TOOLS.every((t) => t.tray === 'quick')).toBe(true)
  })

  it('carries styleDefaults only on the pencil tool (shape has no analogous field -- its style lives in the generic style-value store, never a registry-carried default object)', () => {
    const withDefaults = ATLAS_TOOLS.filter((t) => 'styleDefaults' in t && t.styleDefaults !== undefined)
    expect(withDefaults.map((t) => t.id)).toEqual(['pencil'])
  })

  it('declares styleFields as a real array on every noun (goal 0209, never undefined), non-empty on only pencil and shape', () => {
    expect(ATLAS_TOOLS.every((t) => Array.isArray(t.styleFields))).toBe(true)
    const withFields = ATLAS_TOOLS.filter((t) => t.styleFields.length > 0)
    expect(withFields.map((t) => t.id).sort()).toEqual(['pencil', 'shape'])
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

describe('shapeTool.commit', () => {
  const style = { fill: 'transparent', stroke: '#1f6feb', strokeWidth: 2 }

  it('shapes a rectangle into a Size-bearing artifact, origin at the normalized top-left', () => {
    const artifact = shapeTool.commit({ shapeType: 'rectangle', style, startFlow: { x: 50, y: 80 }, endFlow: { x: 10, y: 20 } })
    expect(artifact).toEqual({
      kind: 'shape', shapeType: 'rectangle', originFlow: { x: 10, y: 20 },
      payload: { shapeType: 'rectangle', fill: 'transparent', stroke: '#1f6feb', strokeWidth: '2', title: 'Rectangle' },
      size: { W: 40, H: 60 },
    })
  })

  it('shapes an ellipse the same way, title Ellipse', () => {
    const artifact = shapeTool.commit({ shapeType: 'ellipse', style, startFlow: { x: 0, y: 0 }, endFlow: { x: 30, y: 30 } })
    expect(artifact.shapeType).toBe('ellipse')
    expect(artifact.payload.title).toBe('Ellipse')
    expect(artifact.size).toEqual({ W: 30, H: 30 })
  })

  it('shapes an arrow into a dx/dy payload with no Size at all, origin at the drag START point (direction-preserving, never normalized)', () => {
    const artifact = shapeTool.commit({ shapeType: 'arrow', style, startFlow: { x: 100, y: 100 }, endFlow: { x: 40, y: 160 } })
    expect(artifact).toEqual({
      kind: 'shape', shapeType: 'arrow', originFlow: { x: 100, y: 100 },
      payload: { shapeType: 'arrow', fill: 'transparent', stroke: '#1f6feb', strokeWidth: '2', title: 'Arrow', dx: '-60', dy: '60' },
      size: null,
    })
  })

  it('floors a near-zero-extent rectangle drag at an 8-unit box rather than a degenerate sliver', () => {
    const artifact = shapeTool.commit({ shapeType: 'rectangle', style, startFlow: { x: 0, y: 0 }, endFlow: { x: 1, y: 1 } })
    expect(artifact.size).toEqual({ W: 8, H: 8 })
  })
})

// Eraser and laser never produce a placeable artifact -- they destroy
// board state or render an ephemeral overlay respectively, never
// create anything -- so their own commit is a stub their own
// gesture.onPoint/onEnd (atlasNounRegistry.ts) never call. These tests
// only pin that the stub stays inert.
describe('eraserTool.commit and laserTool.commit', () => {
  it('are no-op stubs that touch no backend service', () => {
    expect(eraserTool.commit()).toBeNull()
    expect(laserTool.commit()).toBeNull()
    expect(saveImageBytesMock).not.toHaveBeenCalled()
    expect(createListMock).not.toHaveBeenCalled()
  })
})
