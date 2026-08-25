import { PencilIcon } from '@primer/octicons-react'
import { AtlasService } from '../../shared/bindings'
import { identityOf, registerNoun, type AtlasToolShape, type AtlasToolStyleDefaults } from '../atlasNounRegistry'
import type { AtlasStyleField } from '../atlasStyleVocabulary'
import { PENCIL_COLORS, PENCIL_SIZES } from '../atlasStyleValueStore'
import { buildPencilStrokeSvg, svgToBase64, type PencilPoint } from '../atlasPencilSvg'

const pencilIdentity = identityOf('pencil')

// The pencil tool's own declared style surface (goal 0209): rendered by
// the one generic AtlasStylePanel.tsx from these two fields.
const PENCIL_STYLE_FIELDS: readonly AtlasStyleField[] = [
  { key: 'color', type: 'color', testidPrefix: 'atlas-pencil-color', groupLabelKey: 'pencilStyle.colorLabel', options: PENCIL_COLORS, default: PENCIL_COLORS[0] },
  { key: 'size', type: 'stroke-width', render: 'dot', testidPrefix: 'atlas-pencil-size', groupLabelKey: 'pencilStyle.sizeLabel', optionLabelKey: 'pencilStyle.sizeOption', options: PENCIL_SIZES, default: PENCIL_SIZES[1] },
]

// The stroke's own bounding-box origin (atlasPencilSvg.ts's own
// PencilStrokeSvg.originX/Y) rides along on the artifact so the
// placement door (useAtlasPencilCreate.ts) can convert exactly that
// point through screenToFlowPosition -- the card lands where the
// stroke was drawn, not at an arbitrary free slot.
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
  shortcutKey: pencilIdentity.shortcutKey,
  tray: 'quick',
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
  styleDefaults: PENCIL_DEFAULT_STYLE,
  styleFields: PENCIL_STYLE_FIELDS,
  commit: async (input: { points: PencilPoint[]; color: string; size: number }): Promise<AtlasPencilArtifact | null> => {
    const doc = buildPencilStrokeSvg(input.points, input.color, input.size)
    if (!doc) return null
    const mirrorPath = await AtlasService.SaveImageBytes(svgToBase64(doc.svg), '.svg', 'Sketch')
    return { kind: 'pencil', title: 'Sketch', mirrorPath, originX: doc.originX, originY: doc.originY }
  },
} as const satisfies AtlasToolShape

registerNoun(pencilTool)
