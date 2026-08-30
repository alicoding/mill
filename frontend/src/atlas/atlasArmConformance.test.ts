import { describe, expect, it } from 'vitest'
import { ATLAS_TOOLS, isLockableArmTool } from './atlasTools'

// Regression coverage for goal 0199 part D / goal 0181 S3: whether a
// tool locks on re-click (deliberate repeated placement) instead of
// disarming is now a REQUIRED per-noun `lockable` declaration
// (atlasNounRegistry.ts) rather than atlasTools.ts's own hand-
// maintained LOCKABLE_ARM_TOOLS set -- a noun that omits the field
// fails to compile (see atlasNounRegistry.ts's own AtlasToolShapeBase).
// This test pins the RUNTIME behaviour `isLockableArmTool` now reads
// straight off that declaration. Since goal 0252 demoted the drawing
// tools into the bundled Drawing plugin, no COMPILED-IN tool locks --
// shape's lockable: true now arrives through the plugin adapter
// (canvasToolAdapter.test.ts pins the decl door; the shape tool's own
// e2e proves the live behaviour).
describe('isLockableArmTool (goal 0181 S3, regression for goal 0199 part D)', () => {
  it('locks no compiled-in tool (shape moved to the Drawing plugin, goal 0252)', () => {
    const lockableIDs = ATLAS_TOOLS.filter((t) => t.lockable).map((t) => t.id)
    expect(lockableIDs).toEqual([])
  })

  it('agrees with each armable tool\'s own declared answer', () => {
    for (const tool of ATLAS_TOOLS) {
      if (tool.interaction === 'arm-then-click' || tool.interaction === 'drag-to-draw') {
        expect(isLockableArmTool(tool.id as Parameters<typeof isLockableArmTool>[0])).toBe(tool.lockable)
      }
    }
  })
})
