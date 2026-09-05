import { describe, expect, it } from 'vitest'
import {
  activation,
  boxOptsOutOfCanvasWheel,
  contentOptsOutOfCanvasDrag,
  isScrollContainer,
  shieldUp,
  wheelStaysLocal,
  type ScrollBox,
} from './atlasActivation'

// goal 0354: the one activation contract, across its whole input space
// -- which state a board object is in, and which canvas opt-out each
// state derives.
const box = (over: Partial<ScrollBox> = {}): ScrollBox => ({
  scrollWidth: 100, clientWidth: 100, scrollHeight: 100, clientHeight: 100,
  overflowX: 'visible', overflowY: 'visible', ...over,
})

describe('activation', () => {
  it('keeps a static face idle whatever the selection and editing say', () => {
    expect(activation(false, false, 'static')).toBe('idle')
    expect(activation(true, false, 'static')).toBe('idle')
    expect(activation(true, true, 'static')).toBe('idle')
  })

  it('walks an interactive face idle -> selected -> editing', () => {
    expect(activation(false, false, 'interactive')).toBe('idle')
    expect(activation(true, false, 'interactive')).toBe('selected')
    expect(activation(true, true, 'interactive')).toBe('editing')
  })

  it('reports idle for an unselected face that still claims to be editing', () => {
    expect(activation(false, true, 'interactive')).toBe('idle')
  })
})

describe('the derived canvas opt-outs', () => {
  it('hands the wheel and the drag to the face in every live state', () => {
    expect(boxOptsOutOfCanvasWheel('idle')).toBe(false)
    expect(boxOptsOutOfCanvasWheel('selected')).toBe(true)
    expect(boxOptsOutOfCanvasWheel('editing')).toBe(true)
    expect(contentOptsOutOfCanvasDrag('idle')).toBe(false)
    expect(contentOptsOutOfCanvasDrag('selected')).toBe(true)
    expect(contentOptsOutOfCanvasDrag('editing')).toBe(true)
  })

  it('shields only an idle interactive face, never a static one or a preview tile', () => {
    expect(shieldUp('interactive', 'idle', false)).toBe(true)
    expect(shieldUp('interactive', 'selected', false)).toBe(false)
    expect(shieldUp('static', 'idle', false)).toBe(false)
    expect(shieldUp('interactive', 'idle', true)).toBe(false)
  })
})

describe('isScrollContainer', () => {
  it('needs BOTH a scrolling overflow and real overflow', () => {
    expect(isScrollContainer(box({ overflowX: 'auto', scrollWidth: 300 }))).toBe(true)
    expect(isScrollContainer(box({ overflowY: 'scroll', scrollHeight: 300 }))).toBe(true)
    expect(isScrollContainer(box({ overflowX: 'auto' }))).toBe(false)
    expect(isScrollContainer(box({ scrollWidth: 300 }))).toBe(false)
    expect(isScrollContainer(box({ overflowX: 'hidden', scrollWidth: 300 }))).toBe(false)
  })

  it('counts overflow on EITHER axis -- a grid that only scrolls sideways still owns the wheel', () => {
    expect(isScrollContainer(box({ overflowX: 'auto', overflowY: 'auto', scrollWidth: 832 }))).toBe(true)
  })
})

describe('wheelStaysLocal', () => {
  it('keeps the wheel local when a real scroll container sits under the pointer', () => {
    expect(wheelStaysLocal(false, [box(), box({ overflowX: 'auto', scrollWidth: 300 }), box()])).toBe(true)
  })

  it('gives the wheel to the canvas over inert chrome', () => {
    expect(wheelStaysLocal(false, [box(), box()])).toBe(false)
    expect(wheelStaysLocal(false, [])).toBe(false)
  })

  it('keeps the wheel local when the face already consumed it', () => {
    expect(wheelStaysLocal(true, [])).toBe(true)
  })
})
