import type { ContextMenuState } from '../shared/ContextMenu'
import { atlasSelectionContext } from '../shared/atlasSelectionStore'

// A note's own right-click menu (goal 0081 slice A1): Open, Promote
// (the placement popover in promote mode, inside AtlasBoard -- it owns
// the popover's anchoring) and Delete (instant, goal 0093's quick-
// delete-with-undo guard) -- each a registry command over the note as
// the selection (goal 0346 slice B).
export function useAtlasNoteMenu({ setMenu }: { setMenu: (state: ContextMenuState | null) => void }) {
  const openNoteMenu = (noteID: string, pos: { x: number; y: number }) => {
    const ctx = atlasSelectionContext({ cards: [], notes: [noteID], objects: [], links: [] }, { pos })
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'open-note', commandId: 'atlas.note.open', ctx },
        { id: 'promote', commandId: 'atlas.note.promote', ctx },
        { id: 'delete-note', commandId: 'atlas.delete.selection', ctx, danger: true },
      ],
    })
  }

  return { openNoteMenu }
}
