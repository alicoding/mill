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
  interaction: noteIdentity.interaction,
  commit: (input: { text: string }): AtlasNoteArtifact => ({ kind: 'note', text: input.text.trim() }),
} as const satisfies AtlasToolShape

registerNoun(noteTool)
