import type { TFunction } from 'i18next'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { boardObjectContentFor } from './atlasNounRegistry'
import { dispatchObjectEdit, resolveEditRoute } from './objectSeams'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { thirdPartyNounFor } from './atlasNounRegistry'

// A board object's own right-click menu (goal 0179/0180): Promote to
// card is the one explicit, one-way, reversible-only-by-undo action
// out of board-local (mirrors useAtlasNoteMenu.ts's own Promote for
// Note -- the same escape hatch, a different source entity); Delete is
// instant (goal 0093's quick-delete-with-undo guard), feeding the
// shared undo toast. Split out of AtlasView.tsx (architecture.md's
// 500-line convention), same shape useAtlasNoteMenu/useAtlasLinkMenus
// already established for their own entity's menu.
export function useAtlasObjectMenu({
  t, allObjects, setMenu, onDeleted, onError, requestPromoteObject,
}: {
  t: TFunction<'atlas'>
  allObjects: BoardObject[]
  setMenu: (state: ContextMenuState | null) => void
  onDeleted: (result: TombstoneResult) => void
  onError: (message: string) => void
  requestPromoteObject: (objectID: string, pos: { x: number; y: number }) => void
}) {
  const deleteObject = (objectID: string) => {
    AtlasService.DeleteBoardObject(objectID)
      .then((result) => { onDeleted(result); void refreshAtlas() })
      .catch((err) => onError(String(err)))
  }

  const openInDefaultApp = (objectID: string) => {
    AtlasService.OpenObjectMirrorInDefaultApp(objectID).catch((err) => onError(String(err)))
  }

  const openObjectMenu = (objectID: string, pos: { x: number; y: number }) => {
    const object = allObjects.find((o) => o.ID === objectID)
    if (!object) return
    const items: ContextMenuItem[] = [
      { id: 'promote', label: t('contextMenu.promoteToCard'), run: () => requestPromoteObject(object.ID, pos) },
    ]
    // Honest enablement (goal 0232 S1): only a fileBacked Kind with an
    // actual mirrorPath ever gets this item -- never a disabled entry
    // that does nothing on click.
    if (boardObjectContentFor(object.Kind)?.fileBacked && object.Payload?.mirrorPath) {
      items.push({
        id: 'open-in-default-app',
        label: t('contextMenu.openInDefaultApp'),
        commandId: 'object.openInDefaultApp',
        run: () => openInDefaultApp(object.ID),
      })
    }
    // ADR-0046 (goal 0244 S1b): routed through the SAME declared-
    // editRoute resolution AtlasBoardObjectNode.tsx's own double-click
    // gate uses, replacing the S1-era direct isDrawioEditableExtension
    // check -- one mechanism answers "how does this object edit", never
    // two. Only an embedded-engine route (diagram's own .drawio mirror;
    // a .mmd one resolves to external-app, S0's honest finding) gets
    // this item.
    const editRoute = boardObjectContentFor(object.Kind)?.editRoute
    const resolvedEditRoute = editRoute ? resolveEditRoute(object, editRoute) : undefined
    if (resolvedEditRoute?.kind === 'embedded-engine') {
      items.push({
        id: 'edit-diagram',
        label: t('contextMenu.editDiagram'),
        commandId: 'object.editDiagram',
        run: () => { void dispatchObjectEdit(object, editRoute!) },
      })
    }
    // A plugin's own items (goal 0280): only on objects of its kind,
    // between the built-in items and Delete; an item whose enabled
    // predicate answers false is left out, never shown dimmed.
    for (const item of thirdPartyNounFor(object.Kind)?.menuItems ?? []) {
      if (!item.enabled(object)) continue
      items.push({ id: `plugin-${item.id}`, label: item.label, run: () => item.run(object) })
    }
    items.push({ id: 'delete-object', label: t('contextMenu.delete'), danger: true, run: () => deleteObject(object.ID) })
    setMenu({ x: pos.x, y: pos.y, items })
  }

  return { openObjectMenu }
}
