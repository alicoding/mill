import { describe, expect, it } from 'vitest'
import { activation, faceOwnsInput, shieldUp } from './atlasActivation'

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
})
