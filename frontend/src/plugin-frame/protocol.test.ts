// @vitest-environment jsdom
//
// activation.ts is a self-executing script (built as an IIFE, goal
// 0396): importing it for ACTIVATION_CALL_METHODS below runs its
// top-level activation logic too, exactly as loading it with
// <script src> would -- it needs `document`/`window` to read its own
// (absent) mount data and reply with an activation-error over
// postMessage, harmlessly, since nothing here is listening.
import { describe, expect, it } from 'vitest'
import { ACTIVATION_ONLY_METHODS, SIMPLE_DOORS } from '../app/pluginActivationBridge'
import { FRAME_METHODS } from '../app/pluginFrameBridge'
import { CANVAS_TOOL_DOORS } from '../plugins/canvasToolHostDoors'
import { ACTIVATION_CALL_METHODS } from './activation'
import { CANVAS_TOOL_CALLS } from './canvasTools'

// The protocol-surface parity this file replaces the byte-parity test
// with (goal 0396's Found: "the reviewer had to pin drift with a
// byte-parity test" against a hand-copied activation.js). Both halves
// of a call/answer pair -- the frame's own literal method names, and
// the host's own routing tables -- now import nothing from each other
// (an opaque-origin frame builds standalone, goal 0192), so this test
// is the one place drift between them would surface: a door the host
// adds to SIMPLE_DOORS/ACTIVATION_ONLY_METHODS without a matching
// entry here, or the reverse, fails immediately rather than silently
// diverging until a plugin author trips over it.
describe('plugin-frame protocol surface', () => {
  it('every SIMPLE_DOORS name is also reachable from an entry-page frame (FRAME_METHODS) -- the same door works whichever frame calls it', () => {
    const frameMethods: readonly string[] = FRAME_METHODS
    for (const method of SIMPLE_DOORS) expect(frameMethods).toContain(method)
  })

  it("the activation frame runtime's own call surface equals the host's SIMPLE_DOORS plus its activation-only doors -- one source of truth for both sides", () => {
    const expected = new Set<string>([...SIMPLE_DOORS, ...ACTIVATION_ONLY_METHODS])
    const actual = new Set<string>(ACTIVATION_CALL_METHODS)
    expect(actual).toEqual(expected)
  })

  it("the canvas-tool half names the same doors on both sides -- the tool contract cannot drift from what the host routes", () => {
    expect(new Set<string>(CANVAS_TOOL_CALLS)).toEqual(new Set<string>(CANVAS_TOOL_DOORS))
  })
})
