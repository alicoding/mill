import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { BoardObject, Card, Note, Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { childrenOf } from './atlasGrouping'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import type { AtlasCreationTool } from './atlasTools'
import { perspectiveMembershipMenuItems } from './atlasPerspectiveMenuItems'

// AtlasView's own frame/multi-select context menus (goal 0081 slice
// A2, LOCKED design §6d + item 4's dissolve rule) -- split out of
// AtlasView.tsx (architecture.md's 500-line convention) since the
// goal's own context-aware-menu inventory is a self-contained chunk of
// menu-building logic that doesn't need React Flow's own
// screenToFlowPosition (AtlasBoard.tsx keeps that half: the area-draw/
// drag-filing/multi-select-tracking interaction, and the "Group into
// new area"/"Add card"/"Add note" popovers this hook only REQUESTS via
// the same downward-request-token contract useAtlasCreationRequests.ts
// already established).
//
// Delete goes instant everywhere in this file (goal 0093's quick-
// delete-with-undo guard, superseding the ConfirmDialog every Atlas
// delete used to show) -- onDeleted reports each call's TombstoneResult
// to AtlasView's shared undo toast. Dissolve area keeps its confirm
// (a structure rewrite, not a delete): DeleteCard promotes a frame's
// children VIRTUALLY on delete regardless of which door triggered it,
// so "Dissolve area" and a plain Delete on a frame still call the
// exact same AtlasService.DeleteCard -- only Dissolve's own confirm
// copy names the act deliberately, the other doors skip it.
export function useAtlasContainmentMenus({
  t, allCards, notes, allObjects, perspectives, setMenu, drill, onError, onDeleted, onPerspectiveToast, requestPlacementInside, requestGroup, guardDelete,
}: {
  t: TFunction<'atlas'>
  allCards: Card[]
  notes: Note[]
  allObjects: BoardObject[]
  perspectives: Perspective[]
  setMenu: (state: ContextMenuState | null) => void
  drill: (id: string) => void
  onError: (message: string) => void
  onDeleted: (result: TombstoneResult) => void
  onPerspectiveToast: (message: string) => void
  requestPlacementInside: (tool: AtlasCreationTool, pos: { x: number; y: number }, parentID: string) => void
  requestGroup: (cardIDs: string[], noteIDs: string[], objectIDs: string[], pos: { x: number; y: number }) => void
  // The container-delete gate (goal 0149 gap 3) -- confirms when the
  // delete promotes children, runs exec directly otherwise. Dissolve
  // bypasses it: its own dialog already names the promotion. objectIDs
  // is count-only (goal 0179/0180) -- a board object never promotes
  // anything itself.
  guardDelete: (cardIDs: string[], noteIDs: string[], exec: () => void, objectIDs?: string[]) => void
}) {
  const [dissolveTarget, setDissolveTarget] = useState<Card | null>(null)

  // Every direct child (card + note + board object) a dissolve is
  // about to virtually promote -- the confirm dialog's own "N items
  // move up a level" fact (goal 0266: objects promote through the
  // same EffectiveParentID seam, goal 0233).
  const promotedCount = (frameID: string) => childrenOf(allCards, frameID).length + notes.filter((n) => n.ParentID === frameID).length + allObjects.filter((o) => o.ParentID === frameID).length

  const deleteCard = (id: string) => {
    AtlasService.DeleteCard(id)
      .then((result) => { onDeleted(result); void refreshAtlas() })
      .catch((err) => onError(String(err)))
  }

  const dissolveDialog = dissolveTarget && (
    <ConfirmDialog
      title={t('confirm.dissolveTitle', { title: dissolveTarget.Title })}
      body={t('confirm.dissolveBody', { count: promotedCount(dissolveTarget.ID) })}
      confirmLabel={t('confirm.dissolveConfirm')}
      onCancel={() => setDissolveTarget(null)}
      onConfirm={() => {
        const id = dissolveTarget.ID
        setDissolveTarget(null)
        deleteCard(id)
      }}
    />
  )

  const deleteSelection = (cardIDs: string[], noteIDs: string[], objectIDs: string[] = []) => guardDelete(cardIDs, noteIDs, () => {
    // A multi-select delete undoes as ONE step (ADR-0044 decision 2) --
    // BeginUndoMark must resolve before the deletes fire so every
    // concurrent DeleteCard/DeleteNote/DeleteBoardObject call lands in
    // the same mark, and EndUndoMark only after they've all settled.
    void AtlasService.BeginUndoMark().then(() =>
      Promise.all([
        ...cardIDs.map((id) => AtlasService.DeleteCard(id)),
        ...noteIDs.map((id) => AtlasService.DeleteNote(id)),
        ...objectIDs.map((id) => AtlasService.DeleteBoardObject(id)),
      ])
        .then((results) => {
          onDeleted({
            CardIDs: results.flatMap((r) => r.CardIDs ?? []),
            NoteIDs: results.flatMap((r) => r.NoteIDs ?? []),
            ObjectIDs: results.flatMap((r) => r.ObjectIDs ?? []),
            LinksRemoved: results.reduce((sum, r) => sum + (r.LinksRemoved ?? 0), 0),
            ChildrenPromoted: results.reduce((sum, r) => sum + (r.ChildrenPromoted ?? 0), 0),
          })
          void refreshAtlas()
        })
        .catch((err) => onError(String(err)))
        .finally(() => void AtlasService.EndUndoMark()),
    )
  }, objectIDs)

  // Frame interior empty space (LOCKED design §6d): the click point's
  // own frame is the parent, always named in the item -- never a bare
  // "Add card"/"Add note" once a frame is the destination.
  const openFrameInteriorMenu = (frameID: string, pos: { x: number; y: number }) => {
    const frame = allCards.find((c) => c.ID === frameID)
    if (!frame) return
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'add-card-inside', label: t('contextMenu.addCardTo', { title: frame.Title }), run: () => requestPlacementInside('card', pos, frameID) },
        { id: 'add-note-inside', label: t('contextMenu.addNoteInside'), run: () => requestPlacementInside('note', pos, frameID) },
      ],
    })
  }

  // A frame's own header/border (LOCKED design §6d): the full frame
  // menu -- mirror actions (a folder import only, goal 0178 S2),
  // add-inside, zoom, dissolve, delete, in that order.
  const openFrameMenu = (frameID: string, pos: { x: number; y: number }) => {
    const frame = allCards.find((c) => c.ID === frameID)
    if (!frame) return
    const mirrorItems: ContextMenuItem[] = frame.MirrorPath
      ? [
          { id: 'reveal-in-file-manager', label: t('contextMenu.revealInFileManager'), run: () => void AtlasService.RevealCardMirror(frame.ID).catch((err) => onError(String(err))) },
          { id: 'refresh-from-folder', label: t('contextMenu.refreshFromFolder'), run: () => void AtlasService.RefreshMirrorContainer(frame.ID).then(() => refreshAtlas()).catch((err) => onError(String(err))) },
          { id: 'd0', divider: true },
        ]
      : []
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        ...mirrorItems,
        { id: 'add-card-inside', label: t('contextMenu.addCardTo', { title: frame.Title }), run: () => requestPlacementInside('card', pos, frameID) },
        { id: 'zoom', label: t('contextMenu.zoomIn'), run: () => drill(frameID) },
        { id: 'd1', divider: true },
        { id: 'dissolve', label: t('contextMenu.dissolveArea'), run: () => setDissolveTarget(frame) },
        { id: 'delete', label: t('contextMenu.delete'), danger: true, run: () => guardDelete([frameID], [], () => deleteCard(frameID)) },
      ],
    })
  }

  // A multi-selection (LOCKED design §6d): "Group into new area" only
  // once ANY 2+ placed things are selected (goal 0266's peer law:
  // cards, notes and board objects all group); Delete covers every
  // selected card + note + board object together, instantly.
  const openMultiSelectMenu = (cardIDs: string[], noteIDs: string[], objectIDs: string[], pos: { x: number; y: number }) => {
    const items: ContextMenuItem[] = []
    if (cardIDs.length + noteIDs.length + objectIDs.length >= 2) {
      items.push({ id: 'group', label: t('contextMenu.groupIntoArea'), commandId: 'atlas.group.selection', run: () => requestGroup(cardIDs, noteIDs, objectIDs, pos) })
    }
    // The picture of what's selected (docs/goals/0201): commandId with
    // no run() of its own, so the label, the enablement and the action
    // all come from the registry -- the selection these act on is the
    // board's own live one, which is exactly what opened this menu.
    if (items.length > 0) items.push({ id: 'd-image', divider: true })
    items.push({ id: 'copy-as-image', commandId: 'atlas.selection.copyAsImage' })
    items.push({ id: 'export-as-image', commandId: 'atlas.selection.exportAsImage' })
    // Notes never join a perspective (ADR-0041's MemberCardIDs is cards
    // only) -- only the selection's card ids are offered.
    const perspectiveItems = perspectiveMembershipMenuItems({ t, perspectives, cardIDs, pos, setMenu, onToast: onPerspectiveToast })
    if (perspectiveItems.length > 0) {
      items.push({ id: 'd1', divider: true })
      items.push(...perspectiveItems)
      items.push({ id: 'd2', divider: true })
    }
    items.push({ id: 'delete-selection', label: t('contextMenu.delete'), commandId: 'atlas.delete.selection', danger: true, run: () => deleteSelection(cardIDs, noteIDs, objectIDs) })
    setMenu({ x: pos.x, y: pos.y, items })
  }

  return { openFrameMenu, openFrameInteriorMenu, openMultiSelectMenu, deleteSelection, dissolveDialog }
}
