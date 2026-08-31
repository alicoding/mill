import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDropContext } from './atlasFileDropShared'

// resolveDropContext (goal 0256): the toolkit's own file-drop event
// carries a hit-tested context attribute; the file-promise receiver
// delivers coordinates only, so its empty-context payloads resolve
// through a DOM hit-test at the drop point instead. The suite runs in
// the node environment (no DOM package installed -- deliberate), so
// `document` is stubbed to exactly the two calls the helper makes:
// elementFromPoint, then closest().getAttribute() on its result.
function stubDocument(elementAtPoint: unknown) {
  const elementFromPoint = vi.fn(() => elementAtPoint)
  vi.stubGlobal('document', { elementFromPoint })
  return elementFromPoint
}

function elementInsideTarget(context: string | null) {
  return {
    closest: (selector: string) => {
      if (selector !== '[data-file-drop-context]' || context === null) return null
      return { getAttribute: () => context }
    },
  }
}

describe('resolveDropContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the payload context when the toolkit supplied one, never hit-testing', () => {
    const elementFromPoint = stubDocument(null)
    expect(resolveDropContext({ context: 'board', x: 10, y: 10 })).toBe('board')
    expect(elementFromPoint).not.toHaveBeenCalled()
  })

  it('hit-tests the drop point when the context is empty, walking up to the declared target', () => {
    stubDocument(elementInsideTarget('card-page'))
    expect(resolveDropContext({ context: '', x: 5, y: 5 })).toBe('card-page')
  })

  it('returns null when the point hits no declared drop target', () => {
    stubDocument(elementInsideTarget(null))
    expect(resolveDropContext({ x: 5, y: 5 })).toBeNull()
  })

  it('returns null when the point hits nothing at all', () => {
    stubDocument(null)
    expect(resolveDropContext({ x: 5, y: 5 })).toBeNull()
  })

  it('returns null without hit-testing when the payload carries no coordinates', () => {
    const elementFromPoint = stubDocument(null)
    expect(resolveDropContext({})).toBeNull()
    expect(elementFromPoint).not.toHaveBeenCalled()
  })
})
