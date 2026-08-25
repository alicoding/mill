import { SquareIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import { enclosedIDs, normalizeRect } from '../atlasEnclosure'
import { meetsDragThreshold } from '../useAtlasToolGesture'
import { AtlasAreaMarquee } from '../AtlasAreaMarquee'

const areaIdentity = identityOf('area')

export interface AtlasAreaArtifact { kind: 'area'; kindID: string; title: string; enclosedCardIDs: string[]; enclosedNoteIDs: string[] }

export const areaTool = {
  id: areaIdentity.id,
  icon: SquareIcon,
  label: areaIdentity.commandLabel,
  shortcutKey: areaIdentity.shortcutKey,
  tray: 'quick',
  interaction: areaIdentity.interaction,
  lockable: false,
  // AtlasGroupNode carries no NodeResizer at all -- a frame auto-fits
  // its own enclosed children, so a manual resize would fight that.
  resizable: false,
  boardNodeType: 'atlas-group',
  // Not routed through the shared 'atlas-object' renderer -- always
  // false, not N/A.
  dragBand: false,
  // Rendered by AtlasGroupNode, not the shared 'atlas-object' content
  // contract -- always null, not N/A.
  boardObjectKind: null,
  content: null,
  // No style surface of its own (goal 0209) -- always empty, not
  // omitted.
  styleFields: [],
  // Discrete: one placement per arming, matching the LOCKED design's
  // own rule -- never reads a lock flag (never lockable).
  sticky: false,
  // The marker-box/draw-empty gesture (goal 0081 slice A2, LOCKED
  // design section 2): disarms UNCONDITIONALLY at drag end, even for a
  // below-threshold stray click -- "one placement per arming" applies
  // whether or not the draw actually produced a popover, unlike Shape's
  // own one-shot (which only disarms on an ACTUAL commit). Only once
  // the threshold is met does it resolve which top-level cards/notes
  // the drawn rect encloses (atlasEnclosure.ts's own center-inside
  // rule) and open the area popover.
  gesture: {
    onEnd: (points, ctx) => {
      ctx.disarm()
      if (!meetsDragThreshold(points)) return
      const start = points[0], end = points[points.length - 1]
      const flowRect = normalizeRect(ctx.screenToFlowPosition(start), ctx.screenToFlowPosition(end))
      const enclosedCardIDs = enclosedIDs(flowRect, ctx.cardBoxes)
      const enclosedNoteIDs = enclosedIDs(flowRect, ctx.noteBoxes)
      ctx.openAreaPopover(start, { x: flowRect.x, y: flowRect.y }, enclosedCardIDs, enclosedNoteIDs)
    },
    preview: AtlasAreaMarquee,
  },
  commit: (input: { kindID: string; title: string; enclosedCardIDs: string[]; enclosedNoteIDs: string[] }): AtlasAreaArtifact => ({
    kind: 'area',
    kindID: input.kindID,
    title: input.title,
    enclosedCardIDs: input.enclosedCardIDs,
    enclosedNoteIDs: input.enclosedNoteIDs,
  }),
} as const satisfies AtlasToolShape

registerNoun(areaTool)
