import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { atlasSelectionContext } from '../shared/atlasSelectionStore'
import { atlasFacts } from '../shared/atlasSelectionFacts'
import { canvasContextMenuSeatItems } from '../plugins/pluginMenuSeats'

// A board object's own right-click menu (goal 0179/0180): Rename leads
// for a table (goal 0273), Promote to card is the one explicit, one-
// way, reversible-only-by-undo action out of board-local, then the
// object's own doors (Open in default app, Edit diagram, Fit diagram --
// goals 0232, 0244, 0354), a plugin's own imperative items (goal 0280),
// a plugin's DECLARED editor/context items after a separator (goal
// 0349 S2b) and Delete. Every row is a registry command over the
// object as the selection (goal 0346 slice B): which rows apply is the
// command's own honest enablement, never a dimmed entry.
export function useAtlasObjectMenu({ setMenu }: { setMenu: (state: ContextMenuState | null) => void }) {
  const openObjectMenu = (objectID: string, pos: { x: number; y: number }) => {
    const selection = { cards: [], notes: [], objects: [objectID], links: [] }
    const ctx = atlasSelectionContext(selection, { pos })
    const objectFacts = atlasFacts().object(objectID)
    const objectKind = objectFacts?.kind
    const pluginItems: ContextMenuItem[] = (atlasFacts().object(objectID)?.pluginItems ?? []).map((item) => ({
      id: `plugin-${item.id}`,
      commandId: 'atlas.object.pluginAction',
      ctx: atlasSelectionContext(selection, { pos, pluginItem: item.id }),
    }))
    const seatItems: ContextMenuItem[] = objectKind
      ? canvasContextMenuSeatItems(objectKind, objectFacts?.menuFacts ?? {}).map((item, i) => ({ id: `plugin-menu-${i}`, commandId: item.commandId }))
      : []
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'rename', commandId: 'object.rename', ctx },
        { id: 'promote', commandId: 'atlas.object.promote', ctx },
        { id: 'open-in-default-app', commandId: 'object.openInDefaultApp', ctx },
        { id: 'edit-diagram', commandId: 'object.editDiagram', ctx },
        { id: 'fit-diagram', commandId: 'diagram.fit', ctx },
        ...pluginItems,
        ...(seatItems.length > 0 ? [{ id: 'plugin-menu-divider', divider: true }, ...seatItems] : []),
        { id: 'delete-object', commandId: 'atlas.delete.selection', ctx, danger: true },
      ],
    })
  }

  return { openObjectMenu }
}
