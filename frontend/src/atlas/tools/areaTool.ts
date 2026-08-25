import { SquareIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'

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
  commit: (input: { kindID: string; title: string; enclosedCardIDs: string[]; enclosedNoteIDs: string[] }): AtlasAreaArtifact => ({
    kind: 'area',
    kindID: input.kindID,
    title: input.title,
    enclosedCardIDs: input.enclosedCardIDs,
    enclosedNoteIDs: input.enclosedNoteIDs,
  }),
} as const satisfies AtlasToolShape

registerNoun(areaTool)
