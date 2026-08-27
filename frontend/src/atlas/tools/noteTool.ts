import { NoteIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'

const noteIdentity = identityOf('note')

export interface AtlasNoteArtifact { kind: 'note'; text: string }

export const noteTool = {
  id: noteIdentity.id,
  icon: NoteIcon,
  label: noteIdentity.commandLabel,
  shortcutKey: noteIdentity.shortcutKey,
  tray: 'quick',
  // Quick text on the board (goal 0224's disposition table), tray-primary.
  group: 'knowledge',
  interaction: noteIdentity.interaction,
  // Instant placement always disarms after the one click, same as card.
  lockable: false,
  // AtlasStickyNode's own NodeResizer (goal 0193's part B) once the
  // sticky is persisted (`note &&` guard -- a draft has nothing to size).
  resizable: true,
  boardNodeType: 'atlas-sticky',
  // Not routed through the shared 'atlas-object' renderer -- always
  // false, not N/A.
  dragBand: false,
  // No boardObjectKind means no content registration reads this at
  // all -- always false, not N/A.
  fileBacked: false,
  // Rendered by AtlasStickyNode, not the shared 'atlas-object' content
  // contract -- always null, not N/A.
  boardObjectKind: null,
  content: null,
  // No style surface of its own (goal 0209) -- always empty, not
  // omitted.
  styleFields: [],
  // Never drags -- placed by a single click, so this is never read at
  // all; false, not N/A.
  sticky: false,
  gesture: null,
  // The note's own text is markdown SOURCE, byte-exact (goal 0226's
  // round-trip contract) -- unlike a title, trimming it would
  // silently drop a leading/trailing blank line the author typed on
  // purpose.
  commit: (input: { text: string }): AtlasNoteArtifact => ({ kind: 'note', text: input.text }),
} as const satisfies AtlasToolShape

registerNoun(noteTool)
