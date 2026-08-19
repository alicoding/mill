// A render-storm tripwire (goal 0121): an update loop re-renders a
// component thousands of times per second, freezing the window WITHOUT
// throwing -- invisible to the error boundary, force-kill territory
// (observed live on an installed build). This hook counts renders in a
// sliding window and THROWS past the threshold, converting an
// invisible hang into the boundary's copyable report. The threshold
// sits far above real interaction load (React Flow drags/pans render
// at display rate, ~60-120/s; genuine loops run 10k+/s).
import { useEffect, useRef } from 'react'

export interface StormState {
  windowStart: number
  count: number
}

export const STORM_WINDOW_MS = 2000
export const STORM_THRESHOLD = 1500

// Pure per-render tick: returns true when the current window's count
// crosses the threshold. Extracted from the hook for direct unit
// coverage (component-render harnesses are deliberately not used in
// this repo's unit layer).
export function stormTick(state: StormState, now: number, threshold = STORM_THRESHOLD, windowMs = STORM_WINDOW_MS): boolean {
  if (now - state.windowStart > windowMs) {
    state.windowStart = now
    state.count = 0
  }
  state.count++
  return state.count > threshold
}

export function useRenderStormGuard(componentName: string): void {
  const stateRef = useRef<StormState>({ windowStart: 0, count: 0 })
  // Counted per COMMIT (a no-deps effect fires after every render that
  // commits), not per render pass: React Compiler forbids ref access
  // during render, and the observed loop class (state update -> effect
  // -> state update) commits every cycle, so the effect fires each
  // time. An error thrown from an effect reaches the error boundary
  // like a render error does; a setState-during-render loop never gets
  // here, but React's own "Too many re-renders" guard covers that
  // class already.
  useEffect(() => {
    if (stormTick(stateRef.current, Date.now())) {
      throw new Error(
        `render storm: ${componentName} rendered ${stateRef.current.count} times in ${STORM_WINDOW_MS / 1000}s -- ` +
          'an update loop is re-rendering without settling. Copy these details and report them.',
      )
    }
  })
}
