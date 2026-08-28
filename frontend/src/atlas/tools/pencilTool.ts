import { PencilIcon } from '@primer/octicons-react'
import { AtlasService } from '../../shared/bindings'
import { identityOf, registerNoun, type AtlasToolShape, type AtlasToolStyleDefaults } from '../atlasNounRegistry'
import type { AtlasStyleField } from '../atlasStyleVocabulary'
import { PENCIL_COLORS, PENCIL_SIZES, useAtlasStyleValues } from '../atlasStyleValueStore'
import { buildPencilStrokeSvg, svgToBase64, type PencilPoint } from '../atlasPencilSvg'
import { frameContainingPoint } from '../atlasFramePoint'
import { refreshAtlas } from '../atlasStore'
import { meetsDragThreshold } from '../useAtlasToolGesture'
import { AtlasPencilLivePreview } from '../AtlasPencilLivePreview'
import { makeMirrorImageContent } from '../extensions/AtlasMirrorImageContent'

const pencilIdentity = identityOf('pencil')

// The pencil tool's own declared style surface (goal 0209): rendered by
// the one generic AtlasStylePanel.tsx from these two fields.
const PENCIL_STYLE_FIELDS: readonly AtlasStyleField[] = [
  { key: 'color', type: 'color', testidPrefix: 'atlas-pencil-color', groupLabelKey: 'pencilStyle.colorLabel', options: PENCIL_COLORS, default: PENCIL_COLORS[0] },
  { key: 'size', type: 'stroke-width', render: 'dot', testidPrefix: 'atlas-pencil-size', groupLabelKey: 'pencilStyle.sizeLabel', optionLabelKey: 'pencilStyle.sizeOption', options: PENCIL_SIZES, default: PENCIL_SIZES[1] },
]

// The stroke's own bounding-box origin (atlasPencilSvg.ts's own
// PencilStrokeSvg.originX/Y) rides along on the artifact so this tool's
// own gesture.onEnd below can convert exactly that point through
// screenToFlowPosition -- the card lands where the stroke was drawn,
// not at an arbitrary free slot.
export interface AtlasPencilArtifact { kind: 'pencil'; title: string; mirrorPath: string; originX: number; originY: number }

// Pencil (goal 0169 slice 3): the drag-to-draw interaction's own
// proof, and the styleDefaults dual model's real test. size/color are
// SESSION defaults (atlasPencilStyleStore.ts, never persisted) that
// seed a stroke's own commit -- once drawn, colour/size are baked into
// the stroke's SVG bytes below, which IS persisted document data
// (the created card's own MirrorPath file), never re-read from the
// ephemeral cache again.
const PENCIL_DEFAULT_STYLE: AtlasToolStyleDefaults = { color: '#1f6feb', size: 4 }

export const pencilTool = {
  id: pencilIdentity.id,
  icon: PencilIcon,
  label: pencilIdentity.commandLabel,
  description: 'Draws a freehand ink stroke on the board.',
  shortcutKey: pencilIdentity.shortcutKey,
  tray: 'quick',
  // The freehand-marking family (goal 0224's disposition table) --
  // collapsed into the tray's one Annotate group.
  group: 'annotate',
  interaction: pencilIdentity.interaction,
  // Continuous tool: toggleArm's own re-click always disarms (never
  // reads a lock flag) -- multiple strokes come from staying armed
  // across drags, not from locking a discrete placement.
  lockable: false,
  // A stroke lands as an 'ink' BoardObject, through the shared
  // 'atlas-object' renderer -- same resize/drag-band coverage as image.
  resizable: true,
  boardNodeType: 'atlas-object',
  // An ink stroke's whole body already drags -- the shared band would
  // only be debris here (goal 0206's own DESIGN DECIDED table).
  dragBand: false,
  // Payload.mirrorPath names the stroke's own baked SVG file (goal
  // 0232 S1) -- same fileBacked contract image declares.
  fileBacked: true,
  // Placed instance is Kind 'ink', NOT 'pencil' (this tool's own commit
  // below writes it) -- content registers against that Kind, sharing
  // image's own mirrored-file renderer (AtlasMirrorImageContent.tsx).
  // No fallback glyph (goal 0243): a stroke's SVG bytes are never
  // available any sooner than this same mirror fetch, so a pencil
  // glyph would flash on every single mount, not just a failure -- an
  // empty frame is the honest "not there yet" state.
  boardObjectKind: 'ink',
  content: {
    Component: makeMirrorImageContent(null),
    ariaLabelKey: 'boardObject.inkAriaLabel',
    role: 'img',
    // ADR-0046 (goal 0244 S1): a stroke bakes to a real SVG mirror file
    // (this tool's own commit above) -- it fits `file`, not
    // `board-local`, despite never being opened outside Mill; no edit
    // door exists for it (drawn once, never re-edited in place).
    source: { kind: 'file', pathKey: 'mirrorPath' },
    editRoute: { kind: 'none' },
  },
  styleDefaults: PENCIL_DEFAULT_STYLE,
  styleFields: PENCIL_STYLE_FIELDS,
  // Continuous tool: toggleArm's own re-click always disarms it (never
  // reads a lock flag) -- multiple strokes come from staying armed
  // across drags, not from locking a discrete placement. The engine's
  // own gestureDisarmFns makes ctx.disarm/disarmUnlessLocked no-ops
  // below as a result, so this onEnd never needs to avoid calling them.
  sticky: true,
  gesture: {
    onEnd: (points, ctx) => {
      if (!meetsDragThreshold(points) || points.length < 2) return
      const style = useAtlasStyleValues.getState().values.pencil ?? {}
      const color = (style.color as string) ?? PENCIL_COLORS[0]
      const size = (style.size as number) ?? PENCIL_SIZES[1]
      void pencilTool.commit({ points, color, size }).then((artifact) => {
        if (!artifact) return null
        const flowOrigin = ctx.screenToFlowPosition({ x: artifact.originX, y: artifact.originY })
        const targetParentID = frameContainingPoint(ctx.cardBoxes, flowOrigin) ?? ctx.parentID
        return AtlasService.CreateBoardObject('ink', { mirrorPath: artifact.mirrorPath, title: artifact.title }, { X: flowOrigin.x, Y: flowOrigin.y }, targetParentID)
      }).then((created) => { if (created) return refreshAtlas() }).catch(console.error)
    },
    preview: AtlasPencilLivePreview,
  },
  commit: async (input: { points: PencilPoint[]; color: string; size: number }): Promise<AtlasPencilArtifact | null> => {
    const doc = buildPencilStrokeSvg(input.points, input.color, input.size)
    if (!doc) return null
    const mirrorPath = await AtlasService.SaveImageBytes(svgToBase64(doc.svg), '.svg', 'Sketch')
    return { kind: 'pencil', title: 'Sketch', mirrorPath, originX: doc.originX, originY: doc.originY }
  },
} as const satisfies AtlasToolShape

registerNoun(pencilTool)
