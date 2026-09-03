import { describe, expect, it } from 'vitest'
import { viewerOwnsWheel } from './atlasBoardObjectContent'

// goal 0271: the wheel-containment decision across its whole input
// space -- which states put `nowheel` on a board object's node box.
describe('viewerOwnsWheel', () => {
  it('is false for a Kind that never declared wheelContained', () => {
    expect(viewerOwnsWheel({}, false, false)).toBe(false)
    expect(viewerOwnsWheel({}, false, true)).toBe(false)
  })

  it('is always true for a live shieldless wheelContained Kind (diagram)', () => {
    expect(viewerOwnsWheel({ wheelContained: true }, false, false)).toBe(true)
    expect(viewerOwnsWheel({ wheelContained: true }, false, true)).toBe(true)
  })

  it('for a clickShield Kind (pdf), only a SELECTED object contains the wheel -- shielded objects pan the board like any body', () => {
    expect(viewerOwnsWheel({ wheelContained: true, clickShield: true }, false, false)).toBe(false)
    expect(viewerOwnsWheel({ wheelContained: true, clickShield: true }, false, true)).toBe(true)
  })

  it("a frame's preview tile never contains the wheel", () => {
    expect(viewerOwnsWheel({ wheelContained: true }, true, false)).toBe(false)
    expect(viewerOwnsWheel({ wheelContained: true, clickShield: true }, true, true)).toBe(false)
  })
})
