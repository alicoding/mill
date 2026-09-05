import { describe, expect, it } from 'vitest'
import { parkControls } from './liveRunState'

// Which buttons the canvas dock offers for a park, and in which order
// (goal 0328). The order carries the decision: the resume action comes
// first for every kind of pause, so the button under the pointer never
// depends on how the run stopped.
describe('parkControls', () => {
  it('offers Continue, Step and Stop -- in that order -- for a step-mode pause', () => {
    expect(parkControls('debug', true)).toEqual(['continue', 'step', 'stop'])
  })

  it('omits Step at a breakpoint: there is no stepping session to advance', () => {
    expect(parkControls('debug', false)).toEqual(['continue', 'stop'])
  })

  it('leaves a guardrail ask on Approve and Deny, whatever the run was started as', () => {
    expect(parkControls('', false)).toEqual(['approve', 'deny'])
    expect(parkControls('', true)).toEqual(['approve', 'deny'])
  })

  it('never offers a debug control on a policy ask, nor an approval on a debug park', () => {
    expect(parkControls('', true)).not.toContain('step')
    expect(parkControls('debug', true)).not.toContain('approve')
  })
})
