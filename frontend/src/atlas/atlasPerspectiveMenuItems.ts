import type { TFunction } from 'i18next'
import type { Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { refreshAtlas } from './atlasStore'

// The card context menu's "Add to perspective ▸"/"Remove from
// perspective ▸" pair (ADR-0041, goal 0095 slice 2), shared between
// useAtlasLinkMenus.tsx's single-card menu and
// useAtlasContainmentMenus.tsx's multi-select menu -- both call this
// with whichever card ids the click/selection named. Selecting a
// perspective name REPLACES the open menu with that submenu's own
// list (openArteryMenu's "change link kind" already established this
// same click-to-drill shape in this codebase; no separate nested-
// flyout mechanism exists in shared/ContextMenu.tsx). Only cards join
// a perspective (ADR-0041's MemberCardIDs) -- a note id passed in
// `cardIDs` would simply never match a perspective's membership and
// is the caller's own job to exclude.
export function perspectiveMembershipMenuItems({
  t, perspectives, cardIDs, pos, setMenu, onToast,
}: {
  t: TFunction<'atlas'>
  perspectives: Perspective[]
  cardIDs: string[]
  pos: { x: number; y: number }
  setMenu: (state: ContextMenuState | null) => void
  onToast: (message: string) => void
}): ContextMenuItem[] {
  if (perspectives.length === 0 || cardIDs.length === 0) return []

  const addTo = (p: Perspective) => {
    Promise.all(cardIDs.map((id) => AtlasService.AddToPerspective(p.ID, id)))
      .then(() => { onToast(t('perspective.addedToast', { name: p.Name })); void refreshAtlas() })
      .catch((err) => onToast(String(err)))
  }
  const removeFrom = (p: Perspective) => {
    Promise.all(cardIDs.map((id) => AtlasService.RemoveFromPerspective(p.ID, id)))
      .then(() => { onToast(t('perspective.removedToast', { name: p.Name })); void refreshAtlas() })
      .catch((err) => onToast(String(err)))
  }

  const items: ContextMenuItem[] = [
    {
      id: 'add-to-perspective',
      label: t('contextMenu.addToPerspective'),
      run: () => setMenu({
        x: pos.x,
        y: pos.y,
        items: perspectives.map((p): ContextMenuItem => ({ id: `add-${p.ID}`, label: p.Name, run: () => addTo(p) })),
      }),
    },
  ]

  // Only offer to remove from a perspective at least one selected card
  // actually already belongs to -- an empty submenu would be a dead end.
  const removable = perspectives.filter((p) => cardIDs.some((id) => (p.MemberCardIDs ?? []).includes(id)))
  if (removable.length > 0) {
    items.push({
      id: 'remove-from-perspective',
      label: t('contextMenu.removeFromPerspective'),
      run: () => setMenu({
        x: pos.x,
        y: pos.y,
        items: removable.map((p): ContextMenuItem => ({ id: `remove-${p.ID}`, label: p.Name, run: () => removeFrom(p) })),
      }),
    })
  }

  return items
}
