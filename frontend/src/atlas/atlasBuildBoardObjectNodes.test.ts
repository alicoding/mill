import { describe, expect, it } from 'vitest'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { buildBoardObjectNodes } from './atlasBuildBoardObjectNodes'

function makeObject(overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    ID: 'obj-1',
    Kind: 'image',
    Payload: { mirrorPath: '/tmp/shot.png' },
    Position: { X: 10, Y: 20 },
    Size: null,
    ParentID: '',
    CreatedAt: '2026-01-01T00:00:00Z',
    UpdatedAt: '2026-01-01T00:00:00Z',
    DeletedAt: '0001-01-01T00:00:00Z',
    ...overrides,
  } as BoardObject
}

describe('buildBoardObjectNodes', () => {
  it('builds one atlas-object node per board object, carrying its position and identity', () => {
    const objects = [makeObject({ ID: 'img-1', Position: { X: 5, Y: 6 } })]
    const nodes = buildBoardObjectNodes({ objects, readOnly: false, isFree: true })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe('img-1')
    expect(nodes[0].type).toBe('atlas-object')
    expect(nodes[0].position).toEqual({ x: 5, y: 6 })
    expect(nodes[0].data.object.ID).toBe('img-1')
  })

  it('never sets an explicit width/height -- the node lands at its own rendered content size', () => {
    const nodes = buildBoardObjectNodes({ objects: [makeObject()], readOnly: false, isFree: true })
    expect(nodes[0].width).toBeUndefined()
    expect(nodes[0].height).toBeUndefined()
  })

  // Regression: ink must render ON TOP of an image regardless of which
  // was created first (the acceptance contract's own "drawing over a
  // screenshot works") -- pinned via zIndex, not array order.
  it('gives ink a higher zIndex than image regardless of array order', () => {
    const nodes = buildBoardObjectNodes({
      objects: [makeObject({ ID: 'image-1', Kind: 'image' }), makeObject({ ID: 'ink-1', Kind: 'ink' })],
      readOnly: false, isFree: true,
    })
    const image = nodes.find((n) => n.id === 'image-1')!
    const ink = nodes.find((n) => n.id === 'ink-1')!
    expect(ink.zIndex).toBeGreaterThan(image.zIndex!)
  })

  it('is draggable only in Free mode and never in read-only', () => {
    const objects = [makeObject()]
    expect(buildBoardObjectNodes({ objects, readOnly: false, isFree: true })[0].draggable).toBe(true)
    expect(buildBoardObjectNodes({ objects, readOnly: true, isFree: true })[0].draggable).toBe(false)
    expect(buildBoardObjectNodes({ objects, readOnly: false, isFree: false })[0].draggable).toBe(false)
  })
})
