import { describe, expect, it } from 'vitest'
import { activation, contentInert, faceOwnsInput, shieldUp } from './atlasActivation'

// goal 0354: the one activation contract, across its whole input space
// -- which state a board object is in, and which canvas opt-out each
// state derives.

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

describe('the derived canvas opt-out', () => {
  it('hands the wheel, the drag and the pan to the face in every live state', () => {
    expect(faceOwnsInput('idle')).toBe(false)
    expect(faceOwnsInput('selected')).toBe(true)
    expect(faceOwnsInput('editing')).toBe(true)
  })

  it('shields only an idle interactive face, never a static one or a preview tile', () => {
    expect(shieldUp('interactive', 'idle', false)).toBe(true)
    expect(shieldUp('interactive', 'selected', false)).toBe(false)
    expect(shieldUp('static', 'idle', false)).toBe(false)
    expect(shieldUp('interactive', 'idle', true)).toBe(false)
  })

  // goal 0392 S1's CI amendment: a table object's own grid is a real
  // interactive descendant (editable cells), so an idle face -- a
  // preview tile's own state is always idle -- must be `inert`, not
  // just pointer-shielded, or WCAG's aria-hidden-focus rule catches a
  // focusable cell inside a hidden preview. Activating the face (goal
  // 0354's selected/editing states) is what removes it again.
  it('makes an interactive face inert exactly while it is idle, never a static one', () => {
    expect(contentInert('interactive', 'idle')).toBe(true)
    expect(contentInert('interactive', 'selected')).toBe(false)
    expect(contentInert('interactive', 'editing')).toBe(false)
    expect(contentInert('static', 'idle')).toBe(false)
  })
})
