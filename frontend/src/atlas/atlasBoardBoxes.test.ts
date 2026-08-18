import { describe, expect, it } from 'vitest'
import { computeEnclosedBoundingBoxOrigin } from './atlasBoardBoxes'

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
    expect(computeEnclosedBoundingBoxOrigin(['a', 'b'], [], cardBoxes, [])).toEqual({ x: 200, y: 320 })
  })

  it('considers notes alongside cards', () => {
    const cardBoxes = [{ id: 'a', x: 200, y: 400 }]
    const noteBoxes = [{ id: 'n1', x: 100, y: 500 }]
    expect(computeEnclosedBoundingBoxOrigin(['a'], ['n1'], cardBoxes, noteBoxes)).toEqual({ x: 100, y: 400 })
  })

  it('returns null when none of the given ids resolve to a box', () => {
    expect(computeEnclosedBoundingBoxOrigin(['missing'], [], [{ id: 'a', x: 0, y: 0 }], [])).toBeNull()
  })
})
