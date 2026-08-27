import { FileIcon } from '@primer/octicons-react'
import type { Kind } from '../../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import { lastUsedKindID } from '../atlasCreateHelpers'

const cardIdentity = identityOf('card')

export interface AtlasCardArtifact { kind: 'card'; kindID: string; title: string; note: string }

// Card's instant-placement default (goal 0144: the click IS the
// creation, no form) resolves the last-used kind itself; a form-driven
// create (right-click "Add card", paste, slot-link) instead supplies
// kindID/title explicitly and this just shapes them into the same
// artifact -- one function backs both placement doors.
export const cardTool = {
  id: cardIdentity.id,
  icon: FileIcon,
  label: cardIdentity.commandLabel,
  shortcutKey: cardIdentity.shortcutKey,
  tray: 'quick',
  // The atom -- typed, linked, filed, searchable knowledge (goal 0224's
  // disposition table), tray-primary.
  group: 'knowledge',
  interaction: cardIdentity.interaction,
  // Instant placement (goal 0144) always disarms after the one click --
  // never reads a lock flag at all, so this stays false rather than N/A.
  lockable: false,
  // Rendered by AtlasNoteCardNode ('atlas-note'), whose own NodeResizer
  // is the general card resize (goal 0193).
  resizable: true,
  boardNodeType: 'atlas-note',
  // Not routed through the shared 'atlas-object' renderer -- always
  // false, not N/A (atlasNounRegistry.ts's own header comment).
  dragBand: false,
  // No boardObjectKind means no content registration reads this at
  // all -- always false, not N/A.
  fileBacked: false,
  // Rendered by AtlasNoteCardNode, not the shared 'atlas-object'
  // content contract -- always null, not N/A.
  boardObjectKind: null,
  content: null,
  // No style surface of its own (goal 0209) -- always empty, not
  // omitted.
  styleFields: [],
  // Never drags -- placed by a single click (useAtlasCreation.ts's
  // placeAt), so this is never read at all; false, not N/A.
  sticky: false,
  gesture: null,
  commit: (input: { kinds: Kind[]; kindID?: string; title?: string; note?: string }): AtlasCardArtifact => ({
    kind: 'card',
    kindID: input.kindID ?? lastUsedKindID(input.kinds),
    title: input.title ?? 'Untitled',
    note: input.note ?? '',
  }),
} as const satisfies AtlasToolShape

registerNoun(cardTool)
