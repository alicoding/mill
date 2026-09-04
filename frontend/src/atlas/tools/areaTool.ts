import { SquareIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import { normalizeRect } from '../atlasEnclosure'
import { meetsDragThreshold } from '../useAtlasToolGesture'
import { AtlasAreaMarquee } from '../AtlasAreaMarquee'

const areaIdentity = identityOf('area')

export interface AtlasAreaArtifact { kind: 'area'; kindID: string; title: string; enclosedCardIDs: string[]; enclosedNoteIDs: string[]; enclosedObjectIDs: string[] }

export const areaTool = {
  id: areaIdentity.id,
  icon: SquareIcon,
  label: areaIdentity.commandLabel,
  nounName: 'atlas:areaNoun.name',
  description: 'atlas:areaNoun.description',
  shortcutKey: areaIdentity.shortcutKey,
  tray: 'quick',
  // Spatial organization of knowledge, not drawing (goal 0224's
  // disposition table), tray-primary.
  group: 'knowledge',
  interaction: areaIdentity.interaction,
  lockable: false,
  // AtlasGroupNode carries no NodeResizer at all -- a frame auto-fits
  // its own enclosed children, so a manual resize would fight that.
  resizable: false,
  boardNodeType: 'atlas-group',
  // Not routed through the shared 'atlas-object' renderer -- always
  // false, not N/A.
  dragBand: false,
  // No boardObjectKind means no content registration reads this at
  // all -- always false, not N/A.
  fileBacked: false,
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
      const enclosed = ctx.enclosedIn(flowRect)
      ctx.openAreaPopover(start, { x: flowRect.x, y: flowRect.y }, enclosed.cardIDs, enclosed.noteIDs, enclosed.objectIDs)
    },
    preview: AtlasAreaMarquee,
  },
  commit: (input: { kindID: string; title: string; enclosedCardIDs: string[]; enclosedNoteIDs: string[]; enclosedObjectIDs: string[] }): AtlasAreaArtifact => ({
    kind: 'area',
    kindID: input.kindID,
    title: input.title,
    enclosedCardIDs: input.enclosedCardIDs,
    enclosedObjectIDs: input.enclosedObjectIDs,
    enclosedNoteIDs: input.enclosedNoteIDs,
  }),
} as const satisfies AtlasToolShape

registerNoun(areaTool)
