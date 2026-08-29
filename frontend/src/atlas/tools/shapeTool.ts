import { ArrowUpRightIcon, CircleIcon, DiamondIcon, SquareIcon } from '@primer/octicons-react'
import { AtlasService } from '../../shared/bindings'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import type { AtlasStyleField } from '../atlasStyleVocabulary'
import { PENCIL_COLORS, SHAPE_STROKE_WIDTHS, useAtlasStyleValues, type AtlasShapeType } from '../atlasStyleValueStore'
import { boxDimensions, shapePayload, shapeTitle, type ShapeStyle } from '../atlasShapeSvg'
import { frameContainingPoint } from '../atlasFramePoint'
import { refreshAtlas } from '../atlasStore'
import { meetsDragThreshold } from '../useAtlasToolGesture'
import { AtlasShapeLivePreview } from '../AtlasShapeLivePreview'
import { AtlasShapeContent } from '../extensions/AtlasShapeContent'

const shapeIdentity = identityOf('shape')

// The shape tool's own declared style surface (goal 0209): rendered by
// the one generic AtlasStylePanel.tsx from these four fields -- a fifth
// field of an EXISTING vocabulary type (e.g. opacity, reusing
// stroke-width's numeric-range shape) costs this array one entry, never
// a new hand-built picker.
const SHAPE_STYLE_FIELDS: readonly AtlasStyleField[] = [
  {
    key: 'shapeType', type: 'shape-kind', testidPrefix: 'atlas-shape-type', groupLabelKey: 'shapeStyle.typeLabel', default: 'rectangle',
    options: [
      { value: 'rectangle', Icon: SquareIcon, labelKey: 'shapeStyle.type_rectangle' },
      { value: 'ellipse', Icon: CircleIcon, labelKey: 'shapeStyle.type_ellipse' },
      { value: 'arrow', Icon: ArrowUpRightIcon, labelKey: 'shapeStyle.type_arrow' },
    ],
  },
  { key: 'stroke', type: 'color', testidPrefix: 'atlas-shape-stroke', groupLabelKey: 'shapeStyle.strokeLabel', options: PENCIL_COLORS, default: PENCIL_COLORS[0] },
  { key: 'strokeWidth', type: 'stroke-width', render: 'line', testidPrefix: 'atlas-shape-width', groupLabelKey: 'shapeStyle.widthLabel', optionLabelKey: 'shapeStyle.widthOption', options: SHAPE_STROKE_WIDTHS, default: SHAPE_STROKE_WIDTHS[1] },
  // Every new shape starts unfilled -- the converged default across
  // Excalidraw/tldraw/draw.io's own basic shape (docs/goals/0169's own
  // research).
  { key: 'fill', type: 'color-or-none', testidPrefix: 'atlas-shape-fill', groupLabelKey: 'shapeStyle.fillLabel', noneLabelKey: 'shapeStyle.fillNone', options: PENCIL_COLORS, default: 'none' },
]

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
// (the caller, this tool's own gesture.onEnd below, runs
// screenToFlowPosition itself) so commit() stays a pure, synchronous
// function -- unlike every
// other drag-to-draw/paste-or-drop tool, a shape writes no bytes and
// touches no AtlasService call of its own; CreateBoardObject/
// SetBoardObjectSize (already generic since goal 0179 S1) are the
// placement door's job, not this commit's.
export const shapeTool = {
  id: shapeIdentity.id,
  icon: DiamondIcon,
  label: shapeIdentity.commandLabel,
  nounName: 'Shape',
  description: 'Draws a rectangle, ellipse, or arrow.',
  shortcutKey: shapeIdentity.shortcutKey,
  tray: 'quick',
  // The freehand-marking family (goal 0224's disposition table) --
  // collapsed into the tray's one Annotate group.
  group: 'annotate',
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
  // A shape's whole body already drags -- the shared band would only be
  // debris here (goal 0206's own DESIGN DECIDED table). Removing it also
  // makes .content == the node's own box again, closing the paint-vs-
  // frame gap AtlasShapeContent.tsx's own header documents.
  dragBand: false,
  // A shape bakes to no file at all (its own header comment above) --
  // never fileBacked, so it never offers "Open in default app" (goal
  // 0232 S1).
  fileBacked: false,
  boardObjectKind: 'shape',
  content: {
    Component: AtlasShapeContent,
    ariaLabelKey: 'boardObject.shapeAriaLabel',
    role: 'img',
    // ADR-0046 (goal 0244 S1): a shape's geometry lives entirely in its
    // own Payload (this file's own header comment) -- no external file,
    // provider, or url, so `board-local` is the honest source. No edit
    // door either (style changes are a live Payload write, not a
    // separate "open to edit" step).
    source: { kind: 'board-local' },
    editRoute: { kind: 'none' },
  },
  styleFields: SHAPE_STYLE_FIELDS,
  // The one discrete drag tool whose OWN lockable flag governs its
  // repeat mode (goal 0199 part D) -- never sticky itself, so the
  // engine's own gestureDisarmFns always hands this onEnd the real
  // disarm functions, and disarmUnlessLocked is what actually respects
  // a lock.
  sticky: false,
  gesture: {
    onEnd: (points, ctx) => {
      if (!meetsDragThreshold(points)) return
      const startFlow = ctx.screenToFlowPosition(points[0])
      const endFlow = ctx.screenToFlowPosition(points[points.length - 1])
      const style = useAtlasStyleValues.getState().values.shape ?? {}
      const artifact = shapeTool.commit({
        shapeType: (style.shapeType as AtlasShapeType) ?? 'rectangle',
        style: {
          fill: (style.fill as string) ?? 'none',
          stroke: (style.stroke as string) ?? PENCIL_COLORS[0],
          strokeWidth: (style.strokeWidth as number) ?? SHAPE_STROKE_WIDTHS[1],
        },
        startFlow, endFlow,
      })
      const targetParentID = frameContainingPoint(ctx.cardBoxes, artifact.originFlow) ?? ctx.parentID
      void AtlasService.CreateBoardObject('shape', artifact.payload, { X: artifact.originFlow.x, Y: artifact.originFlow.y }, targetParentID)
        .then(async (created) => {
          if (artifact.size) await AtlasService.SetBoardObjectSize(created.ID, artifact.size)
          await refreshAtlas()
          ctx.onShapeCreated(created.ID)
          ctx.disarmUnlessLocked()
        })
        .catch(console.error)
    },
    preview: AtlasShapeLivePreview,
  },
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
