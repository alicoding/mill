import { describe, expect, it } from 'vitest'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { computeEnclosedBoundingBoxOrigin, computeObjectBoxes, computeTopLevelBoxes } from './atlasBoardBoxes'
import { NOTE_HEIGHT, NOTE_WIDTH, TABLE_HEIGHT, TABLE_WIDTH } from './atlasBoardLayout'

describe('computeTopLevelBoxes', () => {
  const card = (over: Partial<Card>): Card => ({ ID: 'c1', KindID: 'k', Title: 'c1', ParentID: 'p', Position: { X: 10, Y: 20 }, ...over } as unknown as Card)

  it('gives a card its default note face', () => {
    expect(computeTopLevelBoxes([card({})], [card({})], [], [], [])).toEqual([
      { id: 'c1', x: 10, y: 20, width: NOTE_WIDTH, height: NOTE_HEIGHT, isFrame: false },
    ])
  })

  // Regression: a resized card kept a note-sized box while rendering at
  // its persisted size, so the drop-target test, the file-into
  // highlight and the alignment peers all aimed at a rectangle the
  // card no longer occupied.
  it('gives a resized card the size it renders at', () => {
    const resized = card({ Size: { W: 420, H: 300 } } as Partial<Card>)
    expect(computeTopLevelBoxes([resized], [resized], [], [], [])).toEqual([
      { id: 'c1', x: 10, y: 20, width: 420, height: 300, isFrame: false },
    ])
  })

  it('gives a List projection its table face', () => {
    const projection = card({ ProjectionListID: 'list-1' } as Partial<Card>)
    expect(computeTopLevelBoxes([projection], [projection], [], [], [])).toEqual([
      { id: 'c1', x: 10, y: 20, width: TABLE_WIDTH, height: TABLE_HEIGHT, isFrame: false },
    ])
  })

  it('lets a free-move override the stored position', () => {
    const c = card({})
    expect(computeTopLevelBoxes([c], [c], [{ id: 'c1', x: 500, y: 600 }], [], [])[0]).toMatchObject({ x: 500, y: 600 })
  })
})

describe('computeObjectBoxes', () => {
  const node = (id: string, x: number, y: number, parentId?: string) => ({
    id, position: { x, y }, parentId, measured: { width: 100, height: 60 }, data: {},
  })

  it('gives a board object its measured box', () => {
    expect(computeObjectBoxes([node('o1', 40, 90)])).toEqual([{ id: 'o1', x: 40, y: 90, width: 100, height: 60 }])
  })

  // Regression: a filed object's node position is relative to its
  // frame, so including it offered every consumer a rectangle that is
  // nowhere on screen -- an alignment peer at a phantom coordinate.
  it('leaves out an object filed into a frame', () => {
    expect(computeObjectBoxes([node('o1', 40, 90), node('filed', 8, 8, 'frame-1')])).toEqual([
      { id: 'o1', x: 40, y: 90, width: 100, height: 60 },
    ])
  })
})

describe('computeEnclosedBoundingBoxOrigin', () => {
  // Regression: select-then-group anchored the new container at the
  // triggering click point (a member right-click, or the selection
  // tray's own bottom-center Group button) instead of where the
  // grouped members actually render -- the tray path always landed
  // the new area at the bottom of the board regardless of the
  // members' real position.
  it('returns the top-left of the union of the enclosed members boxes', () => {
    const cardBoxes = [
      { id: 'a', x: 200, y: 400 },
      { id: 'b', x: 350, y: 320 },
      { id: 'unrelated', x: 0, y: 0 },
    ]
    expect(computeEnclosedBoundingBoxOrigin(['a', 'b'], [], [], cardBoxes, [], [])).toEqual({ x: 200, y: 320 })
  })

  it('considers notes alongside cards', () => {
    const cardBoxes = [{ id: 'a', x: 200, y: 400 }]
    const noteBoxes = [{ id: 'n1', x: 100, y: 500 }]
    expect(computeEnclosedBoundingBoxOrigin(['a'], ['n1'], [], cardBoxes, noteBoxes, [])).toEqual({ x: 100, y: 400 })
  })

  it('returns null when none of the given ids resolve to a box', () => {
    expect(computeEnclosedBoundingBoxOrigin(['missing'], [], [], [{ id: 'a', x: 0, y: 0 }], [], [])).toBeNull()
  })
})
