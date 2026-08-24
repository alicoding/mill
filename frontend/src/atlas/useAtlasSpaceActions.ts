import type { TFunction } from 'i18next'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import type { ContextMenuItem } from '../shared/ContextMenu'

// Space-management actions (docs/goals/0183): rename/delete the
// currently-viewed space from its own empty-board context menu -- the
// one door that makes "how do I get rid of it" reachable without
// leaving the space first (the meta "All spaces" level, reached via
// atlas.up, offers the same actions through the ordinary card context
// menu once the user navigates up to it; this hook is the second,
// from-inside door). Split out of AtlasView.tsx (architecture.md's
// 500-line convention), same pattern as useAtlasNoteMenu/
// useAtlasObjectMenu.
export function useAtlasSpaceActions({
  t, viewedCard, guardDelete, onDeleted, onError, onOpenOverlay, onNavigate, onNewSpace,
}: {
  t: TFunction<'atlas'>
  viewedCard: Card | null
  guardDelete: (cardIDs: string[], noteIDs: string[], exec: () => void) => void
  onDeleted: (result: TombstoneResult) => void
  onError: (message: string) => void
  onOpenOverlay: (id: string) => void
  onNavigate: (id: string) => void
  onNewSpace: () => void
}) {
  // Reuses the same guardDelete + instant-with-undo pattern every
  // other Atlas delete door already goes through
  // (useAtlasLinkMenus.tsx's own deleteCard); navigates to the meta
  // level afterward, since viewedID would otherwise keep pointing at a
  // card that no longer exists. refreshAtlas is awaited BEFORE that
  // navigation, not fired alongside it: AtlasView's own auto-entry
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
  // "this board's own card IS a space" is true. Rename reuses the
  // card's own page overlay (its title field is already the rename
  // UI); Delete reuses the guarded door above.
  const spaceMenuItems = (): ContextMenuItem[] => {
    if (!viewedCard || viewedCard.ParentID !== '') return []
    return [
      { id: 'd-space', divider: true },
      { id: 'new-space', label: t('contextMenu.newSpace'), run: onNewSpace },
      { id: 'rename-space', label: t('contextMenu.renameSpace'), run: () => onOpenOverlay(viewedCard.ID) },
      { id: 'delete-space', label: t('contextMenu.deleteSpace'), danger: true, run: () => deleteCurrentSpace(viewedCard.ID) },
    ]
  }

  return { spaceMenuItems }
}
