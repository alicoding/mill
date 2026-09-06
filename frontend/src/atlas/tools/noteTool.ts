import { NoteIcon } from '@primer/octicons-react'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import type { ObjectSource, EditRoute } from '../objectSeams'

const noteIdentity = identityOf('note')

export interface AtlasNoteArtifact { kind: 'note'; text: string }

// The note's own ADR-0046 seam declaration (goal 0244 S3): its text
// lives in the Note entity itself, no external file/provider/url --
// board-local, same source kind as shape's own geometry. editRoute is
// 'inline': the sticky/overlay/page field ARE the editor, no separate
// door to dispatch to. Exported as standalone constants rather than
// nested under `content` below -- a Note is its own domain entity
// (internal/domain/atlas/note.go), not a BoardObject, so it never
// flows through boardObjectContentFor/dispatchObjectEdit (both keyed
// on BoardObject); atlasNounRegistry.ts's own AtlasToolShapeBase
// contract requires `content` to stay null whenever boardObjectKind is
// null (note's case), so this names the same two seams in the same
// vocabulary (objectSeams.ts's own types) without forcing the note
// through machinery built for a different entity shape.
export const noteSource: ObjectSource = { kind: 'board-local' }
export const noteEditRoute: EditRoute = { kind: 'inline' }

export const noteTool = {
  id: noteIdentity.id,
  icon: NoteIcon,
  label: noteIdentity.commandLabel,
  nounName: 'atlas:noteNoun.name',
  description: 'atlas:noteNoun.description',
  shortcutKey: noteIdentity.shortcutKey,
  tray: 'quick',
  // Quick text on the board (goal 0224's disposition table), tray-primary.
  group: 'objects',
  // The first declared extension setting (goal 0258 S1). richCodeBlocks
  // re-enables the markdown engine's own code-block editor feature that
  // the canvas trim keeps off by default (milkdownCore.ts's
  // NOTE_FEATURES) -- an explicit user opt-in is exactly what that trim
  // left room for. Read at editor mount (MilkdownEditor.tsx), so the
  // description states the taking-effect honestly.
  settings: [
    {
      type: 'boolean',
      key: 'richCodeBlocks',
      label: 'atlas:noteNoun.settings.richCodeBlocks.label',
      description: 'atlas:noteNoun.settings.richCodeBlocks.description',
      defaultValue: false,
    },
  ],
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
