import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { childrenOf } from './atlasGrouping'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import type { AtlasCreationTool } from './AtlasCreationTray'

// AtlasView's own frame/multi-select context menus and their dissolve/
// delete-with-promotion confirm dialogs (goal 0081 slice A2, LOCKED
// design §6d + item 4's dissolve rule) -- split out of AtlasView.tsx
// (architecture.md's 500-line convention) since the goal's own
// context-aware-menu inventory is a self-contained chunk of menu-
// building + confirm-dialog logic that doesn't need React Flow's own
// screenToFlowPosition (AtlasBoard.tsx keeps that half: the area-draw/
// drag-filing/multi-select-tracking interaction, and the "Group into
// new area"/"Add card"/"Add note" popovers this hook only REQUESTS via
// the same downward-request-token contract useAtlasCreationRequests.ts
// already established).
//
// DeleteCard now promotes children server-side unconditionally
// (atlassvc's own dissolve rule) -- "Dissolve area" and a plain Delete
// on a frame call the exact same AtlasService.DeleteCard; only the
// confirm dialog's own copy differs, naming the act the user chose.
export function useAtlasContainmentMenus({
  t, allCards, notes, setMenu, drill, onError, requestPlacementInside, requestGroup,
}: {
  t: TFunction<'atlas'>
  allCards: Card[]
  notes: Note[]
  setMenu: (state: ContextMenuState | null) => void
  drill: (id: string) => void
  onError: (message: string) => void
  requestPlacementInside: (tool: AtlasCreationTool, pos: { x: number; y: number }, parentID: string) => void
  requestGroup: (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => void
}) {
  const [dissolveTarget, setDissolveTarget] = useState<Card | null>(null)
  const [deleteFrameTarget, setDeleteFrameTarget] = useState<Card | null>(null)

  // Every direct child (card + note) a dissolve/delete is about to
  // promote -- the confirm dialog's own "N cards move up a level" fact.
  const promotedCount = (frameID: string) => childrenOf(allCards, frameID).length + notes.filter((n) => n.ParentID === frameID).length

  const dissolveDialog = dissolveTarget && (
    <ConfirmDialog
      title={t('confirm.dissolveTitle', { title: dissolveTarget.Title })}
      body={t('confirm.dissolveBody', { count: promotedCount(dissolveTarget.ID) })}
      confirmLabel={t('confirm.dissolveConfirm')}
      onCancel={() => setDissolveTarget(null)}
      onConfirm={() => {
        const id = dissolveTarget.ID
        setDissolveTarget(null)
        AtlasService.DeleteCard(id).then(() => refreshAtlas()).catch((err) => onError(String(err)))
      }}
    />
  )

  const deleteFrameDialog = deleteFrameTarget && (
    <ConfirmDialog
      title={t('confirm.deleteFrameTitle', { title: deleteFrameTarget.Title })}
      body={t('confirm.deleteFrameBody', { count: promotedCount(deleteFrameTarget.ID) })}
      onCancel={() => setDeleteFrameTarget(null)}
      onConfirm={() => {
        const id = deleteFrameTarget.ID
        setDeleteFrameTarget(null)
        AtlasService.DeleteCard(id).then(() => refreshAtlas()).catch((err) => onError(String(err)))
      }}
    />
  )

  const { requestDelete: requestDeleteSelection, dialog: deleteSelectionDialog } = useConfirmDelete<{ cardIDs: string[]; noteIDs: string[] }>({
    entityType: 'cards',
    labelOf: (sel) => {
      const parts: string[] = []
      if (sel.cardIDs.length > 0) parts.push(`${sel.cardIDs.length} card${sel.cardIDs.length === 1 ? '' : 's'}`)
      if (sel.noteIDs.length > 0) parts.push(`${sel.noteIDs.length} note${sel.noteIDs.length === 1 ? '' : 's'}`)
      return parts.join(' and ')
    },
    onConfirm: (sel) => {
      Promise.all([
        ...sel.cardIDs.map((id) => AtlasService.DeleteCard(id)),
        ...sel.noteIDs.map((id) => AtlasService.DeleteNote(id)),
      ]).then(() => refreshAtlas()).catch((err) => onError(String(err)))
    },
  })

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
  // menu -- add-inside, zoom, dissolve, delete, in that order.
  const openFrameMenu = (frameID: string, pos: { x: number; y: number }) => {
    const frame = allCards.find((c) => c.ID === frameID)
    if (!frame) return
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'add-card-inside', label: t('contextMenu.addCardTo', { title: frame.Title }), run: () => requestPlacementInside('card', pos, frameID) },
        { id: 'zoom', label: t('contextMenu.zoomIn'), run: () => drill(frameID) },
        { id: 'd1', divider: true },
        { id: 'dissolve', label: t('contextMenu.dissolveArea'), run: () => setDissolveTarget(frame) },
        { id: 'delete', label: t('contextMenu.delete'), danger: true, run: () => setDeleteFrameTarget(frame) },
      ],
    })
  }

  // A multi-selection (LOCKED design §6d): "Group into new area" only
  // once 2+ CARDS are selected (a notes-only selection gets no group
  // item -- notes simply ride along when cards ARE present); Delete
  // covers every selected card + note together.
  const openMultiSelectMenu = (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => {
    const items: ContextMenuItem[] = []
    if (cardIDs.length >= 2) {
      items.push({ id: 'group', label: t('contextMenu.groupIntoArea'), run: () => requestGroup(cardIDs, noteIDs, pos) })
    }
    items.push({ id: 'delete-selection', label: t('contextMenu.delete'), danger: true, run: () => requestDeleteSelection({ cardIDs, noteIDs }) })
    setMenu({ x: pos.x, y: pos.y, items })
  }

  // Keyboard Delete on a live selection (goal 0089 rider): same
  // confirm + delete path as the multi-select menu's own item.
  const deleteSelection = (cardIDs: string[], noteIDs: string[]) => requestDeleteSelection({ cardIDs, noteIDs })

  return { openFrameMenu, openFrameInteriorMenu, openMultiSelectMenu, deleteSelection, dissolveDialog, deleteFrameDialog, deleteSelectionDialog }
}
