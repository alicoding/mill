import type { TFunction } from 'i18next'
import type { Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import type { ContextMenuState } from '../shared/ContextMenu'

// A note's own right-click menu (goal 0081 slice A1): Promote opens
// the placement popover in promote mode (useAtlasCreation.ts, inside
// AtlasBoard -- it owns the popover's anchoring); Delete is instant
// (goal 0093's quick-delete-with-undo guard), feeding the shared undo
// toast. Split out of AtlasView.tsx (architecture.md's 500-line
// convention), same shape useAtlasLinkMenus/useAtlasContainmentMenus
// already established for the card/frame menus.
export function useAtlasNoteMenu({
  t, allNotes, setMenu, onDeleted, onError, requestPromote,
}: {
  t: TFunction<'atlas'>
  allNotes: Note[]
  setMenu: (state: ContextMenuState | null) => void
  onDeleted: (result: TombstoneResult) => void
  onError: (message: string) => void
  requestPromote: (noteID: string, pos: { x: number; y: number }) => void
}) {
  const deleteNote = (noteID: string) => {
    AtlasService.DeleteNote(noteID)
      .then((result) => { onDeleted(result); void refreshAtlas() })
      .catch((err) => onError(String(err)))
  }

  const openNoteMenu = (noteID: string, pos: { x: number; y: number }) => {
    const note = allNotes.find((n) => n.ID === noteID)
    if (!note) return
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'promote', label: t('contextMenu.promoteToCard'), run: () => requestPromote(note.ID, pos) },
        { id: 'delete-note', label: t('contextMenu.deleteNote'), danger: true, run: () => deleteNote(note.ID) },
      ],
    })
  }

  return { openNoteMenu }
}
