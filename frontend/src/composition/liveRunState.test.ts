import { describe, expect, it } from 'vitest'
import { shouldAdoptExternalRun } from './liveRunState'

// GAP A of the live-canvas-sync work: an externally-started run (a
// headless trigger fire, or an MCP run_workflow/debug tool call) must
// surface on an already-open editor without yanking the display away
// from a run the user is actively watching. shouldAdoptExternalRun is
// the pure decision point -- see its own doc comment in liveRunState.ts.

describe('shouldAdoptExternalRun', () => {
  it('adopts when nothing is currently displayed', () => {
    expect(shouldAdoptExternalRun(false, false)).toBe(true)
  })

  it('adopts when the currently-displayed run has already finished', () => {
    expect(shouldAdoptExternalRun(true, false)).toBe(true)
  })

  it('does NOT adopt while the currently-displayed run is still in flight', () => {
    expect(shouldAdoptExternalRun(true, true)).toBe(false)
  })

  it('activeRunInFlight=true with hasActiveRun=false is not a real state, but stays adopt-safe', () => {
    // Defensive case: a caller can only construct this by mistake (an
    // "in flight" flag with no active run at all) -- shouldAdoptExternalRun
    // still resolves it the safe way (adopt) rather than getting stuck.
    expect(shouldAdoptExternalRun(false, true)).toBe(true)
  })
})
