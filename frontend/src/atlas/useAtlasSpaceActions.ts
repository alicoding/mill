import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { atlasSelectionContext } from '../shared/atlasSelectionStore'

// Space-management actions (docs/goals/0183): rename/delete the
// currently-viewed space from its own empty-board context menu -- the
// one door that makes "how do I get rid of it" reachable without
// leaving the space first (the meta "All spaces" level, reached via
// atlas.up, offers the same actions through the ordinary card context
// menu once the user navigates up to it; this hook is the second,
// from-inside door). The items are registry commands over the viewed
// root card as the selection (goal 0346 slice B); deleteCurrentSpace is
// the executor the atlas.space.delete request lands on.
export function useAtlasSpaceActions({
  viewedCard, setMenu, guardDelete, onDeleted, onError, onNavigate,
}: {
  viewedCard: Card | null
  setMenu: (state: ContextMenuState | null) => void
  guardDelete: (cardIDs: string[], noteIDs: string[], exec: () => void) => void
  onDeleted: (result: TombstoneResult) => void
  onError: (message: string) => void
  onNavigate: (id: string) => void
}) {
  // Reuses the same guardDelete + instant-with-undo pattern every
  // other Atlas delete door already goes through; navigates to the
  // meta level afterward, since viewedID would otherwise keep pointing
  // at a card that no longer exists. refreshAtlas is awaited BEFORE
  // that navigation, not fired alongside it: AtlasView's own auto-entry
  // effect reacts to viewedID==="" immediately, and reading the store's
  // still-stale cards (the just-deleted card still the sole root)
  // would auto-re-enter a card that no longer exists server-side.
  const deleteCurrentSpace = (id: string) => guardDelete([id], [], () => {
    AtlasService.DeleteCard(id)
      .then((result) => { onDeleted(result); return refreshAtlas() })
      .then(() => onNavigate(''))
      .catch((err) => onError(String(err)))
  })

  // Only offered while viewing a root-level board -- the one place
  // "this board's own card IS a space" is true; the commands' own
  // enablement re-checks it.
  const spaceMenuItems = (): ContextMenuItem[] => {
    if (!viewedCard || viewedCard.ParentID !== '') return []
    const ctx = atlasSelectionContext({ cards: [viewedCard.ID], notes: [], objects: [], links: [] })
    return [
      { id: 'd-space', divider: true },
      { id: 'new-space', commandId: 'atlas.space.new' },
      { id: 'rename-space', commandId: 'atlas.space.rename', ctx },
      { id: 'delete-space', commandId: 'atlas.space.delete', ctx, danger: true },
    ]
  }

  // The empty-board right-click (goal 0081 A2 rider b): direct-
  // placement doors at the click point -- nothing selected, so the add
  // commands place on this board (goal 0346 slice B) -- then the space
  // items above.
  const openPaneMenu = (pos: { x: number; y: number }) => {
    const ctx = atlasSelectionContext({ cards: [], notes: [], objects: [], links: [] }, { pos })
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'add-card-here', commandId: 'atlas.board.addCard', ctx },
        { id: 'add-note-here', commandId: 'atlas.board.addNote', ctx },
        ...spaceMenuItems(),
      ],
    })
  }

  return { spaceMenuItems, openPaneMenu, deleteCurrentSpace }
}
