import { describe, expect, it } from 'vitest'
import { barStateFor, shouldAdoptExternalRun } from './liveRunState'
import type { RunDetail } from '../shared/bindings'

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

// A run that was waiting on a person when Mill relaunched under a
// different workflow-code version: the engine will never pick it back
// up, so the canvas must stop offering Resume/Stop and say so. The
// ordering matters -- the run still carries the durable pending event
// its park wrote, so a naive "pending first" check keeps the dead
// buttons on screen.
describe('barStateFor', () => {
  const parked = {
    status: 'PENDING',
    pending: { nodeID: 'n1', nodeTypeLabel: 'Send email' },
    steps: [],
    error: '',
  } as unknown as RunDetail

  it('shows nothing when no run is displayed', () => {
    expect(barStateFor(null, '')).toBeNull()
  })

  it('shows the parked bar for a run genuinely awaiting a decision', () => {
    expect(barStateFor(parked, '')?.mode).toBe('parked')
  })

  it('shows the interrupted bar, not the parked one, once the run is interrupted', () => {
    const interrupted = { ...parked, status: 'CANCELLED', interrupted: true } as unknown as RunDetail
    expect(barStateFor(interrupted, '')?.mode).toBe('interrupted')
  })

  it('shows the finished bar for a run that ended without a park', () => {
    const done = { status: 'SUCCESS', steps: [], error: '' } as unknown as RunDetail
    expect(barStateFor(done, '')).toEqual({ mode: 'finished', status: 'SUCCESS', error: '' })
  })

  it('a rejected start outranks every run state', () => {
    expect(barStateFor(parked, 'workflow not found')?.mode).toBe('finished')
  })
})
