import type { TFunction } from 'i18next'
import type { ContextMenuItem } from '../shared/ContextMenu'
import { atlasSelectionContext } from '../shared/atlasSelectionStore'
import { atlasFacts } from '../shared/atlasSelectionFacts'

// The card context menu's "Add to perspective ▸"/"Remove from
// perspective ▸" pair (ADR-0041, goal 0095 slice 2), shared between
// useAtlasLinkMenus.tsx's single-card menu and
// useAtlasContainmentMenus.tsx's multi-select menu -- both call this
// with whichever card ids the click/selection named. Each head opens a
// submenu naming every perspective; each row is the ONE membership
// command with the perspective in its target (goal 0346 slice B), and
// a head with nothing under it is absent. Only cards join a
// perspective (ADR-0041's MemberCardIDs) -- the caller passes card ids
// only.
export function perspectiveMembershipMenuItems({ t, cardIDs }: {
  t: TFunction<'atlas'>
  cardIDs: string[]
}): ContextMenuItem[] {
  const selection = { cards: cardIDs, notes: [], objects: [], links: [] }
  const rows = (commandId: string) => atlasFacts().perspectives().map((p): ContextMenuItem => ({
    id: `${commandId}-${p.id}`,
    commandId,
    ctx: atlasSelectionContext(selection, { perspective: p.id }),
  }))
  return [
    { id: 'add-to-perspective', label: t('contextMenu.addToPerspective'), submenu: rows('atlas.selection.addToPerspective') },
    { id: 'remove-from-perspective', label: t('contextMenu.removeFromPerspective'), submenu: rows('atlas.selection.removeFromPerspective') },
  ]
}
