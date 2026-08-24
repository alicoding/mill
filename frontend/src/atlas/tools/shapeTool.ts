import { DiamondIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import { AtlasShapeStylePicker } from '../AtlasShapeStylePicker'
import type { AtlasShapeType } from '../atlasShapeStyleStore'
import { boxDimensions, shapePayload, shapeTitle, type ShapeStyle } from '../atlasShapeSvg'

const shapeIdentity = identityOf('shape')

// Unlike image/pencil, a shape never bakes to a mirror file -- fill/
// stroke/strokeWidth stay live Payload data (this tool's own "style
// lives in Payload" contract, so a future style editor -- goal 0193 --
// can change them without re-drawing). originFlow is the BoardObject's
// own Position; size is set via a follow-up SetBoardObjectSize call for
// rectangle/ellipse (an arrow's own geometry is entirely payload.dx/dy,
// so it carries no Size at all).
export interface AtlasShapeArtifact { kind: 'shape'; shapeType: AtlasShapeType; originFlow: { x: number; y: number }; payload: Record<string, string>; size: { W: number; H: number } | null }

// Shape (goal 0169 slice 5): drag-to-draw's second proof, reusing the
// interaction shape unchanged rather than inventing a seventh. ONE
// tray tool covers all three geometric shapes -- rectangle, ellipse,
// arrow -- picked via AtlasShapeStylePicker while armed, the same
// "options bar anchored to the armed tool" surface pencil already
// established; this tool's own contract is "not a shape library, one
// tool", so the type lives in the style picker rather than three
// separate tray buttons. startFlow/endFlow are already flow-space
// (the caller, useAtlasShapeCreate.ts, runs screenToFlowPosition
// itself) so this stays a pure, synchronous function -- unlike every
// other drag-to-draw/paste-or-drop tool, a shape writes no bytes and
// touches no AtlasService call of its own; CreateBoardObject/
// SetBoardObjectSize (already generic since goal 0179 S1) are the
// placement door's job, not this commit's.
export const shapeTool = {
  id: shapeIdentity.id,
  icon: DiamondIcon,
  label: shapeIdentity.commandLabel,
  shortcutKey: shapeIdentity.shortcutKey,
  tray: 'quick',
  interaction: shapeIdentity.interaction,
  // The one discrete drag tool that locks for deliberate repetition
  // (goal 0199 part D) -- re-clicking the armed Shape button locks it
  // rather than disarming, so drawing several shapes in a row doesn't
  // mean re-arming after every one. This is the exact per-noun answer
  // that used to live in atlasTools.ts's own hand-maintained
  // LOCKABLE_ARM_TOOLS set (goal 0181 S3 replaces it with this
  // declaration, read by isLockableArmTool below).
  lockable: true,
  // A drawn shape lands as a 'shape' BoardObject through the shared
  // 'atlas-object' renderer -- same resize/drag-band coverage as image
  // and ink (an arrow's own SIZE-less carve-out is payload-level, not a
  // per-noun fact, so it isn't modelled here).
  resizable: true,
  boardNodeType: 'atlas-object',
  StylePicker: AtlasShapeStylePicker,
  commit: (input: { shapeType: AtlasShapeType; style: ShapeStyle; startFlow: { x: number; y: number }; endFlow: { x: number; y: number } }): AtlasShapeArtifact => {
    const dx = input.endFlow.x - input.startFlow.x
    const dy = input.endFlow.y - input.startFlow.y
    const title = shapeTitle(input.shapeType)
    if (input.shapeType === 'arrow') {
      return { kind: 'shape', shapeType: 'arrow', originFlow: input.startFlow, payload: shapePayload('arrow', input.style, title, { dx, dy }), size: null }
    }
    const { w, h } = boxDimensions(dx, dy)
    const originFlow = { x: Math.min(input.startFlow.x, input.endFlow.x), y: Math.min(input.startFlow.y, input.endFlow.y) }
    return { kind: 'shape', shapeType: input.shapeType, originFlow, payload: shapePayload(input.shapeType, input.style, title), size: { W: w, H: h } }
  },
} as const satisfies AtlasToolShape

registerNoun(shapeTool)
