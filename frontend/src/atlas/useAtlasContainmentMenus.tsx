import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { Card, Note, Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { childrenOf } from './atlasGrouping'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import type { AtlasCreationTool } from './AtlasCreationTray'
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
  t, allCards, notes, perspectives, setMenu, drill, onError, onDeleted, onPerspectiveToast, requestPlacementInside, requestGroup,
}: {
  t: TFunction<'atlas'>
  allCards: Card[]
  notes: Note[]
  perspectives: Perspective[]
  setMenu: (state: ContextMenuState | null) => void
  drill: (id: string) => void
  onError: (message: string) => void
  onDeleted: (result: TombstoneResult) => void
  onPerspectiveToast: (message: string) => void
  requestPlacementInside: (tool: AtlasCreationTool, pos: { x: number; y: number }, parentID: string) => void
  requestGroup: (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => void
}) {
  const [dissolveTarget, setDissolveTarget] = useState<Card | null>(null)

  // Every direct child (card + note) a dissolve is about to virtually
  // promote -- the confirm dialog's own "N cards move up a level" fact.
  const promotedCount = (frameID: string) => childrenOf(allCards, frameID).length + notes.filter((n) => n.ParentID === frameID).length

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

  const deleteSelection = (cardIDs: string[], noteIDs: string[]) => {
    Promise.all([
      ...cardIDs.map((id) => AtlasService.DeleteCard(id)),
      ...noteIDs.map((id) => AtlasService.DeleteNote(id)),
    ])
      .then((results) => {
        onDeleted({
          CardIDs: results.flatMap((r) => r.CardIDs ?? []),
          NoteIDs: results.flatMap((r) => r.NoteIDs ?? []),
          LinksRemoved: results.reduce((sum, r) => sum + (r.LinksRemoved ?? 0), 0),
          ChildrenPromoted: results.reduce((sum, r) => sum + (r.ChildrenPromoted ?? 0), 0),
        })
        void refreshAtlas()
      })
      .catch((err) => onError(String(err)))
  }

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
        { id: 'delete', label: t('contextMenu.delete'), danger: true, run: () => deleteCard(frameID) },
      ],
    })
  }

  // A multi-selection (LOCKED design §6d): "Group into new area" only
  // once 2+ CARDS are selected (a notes-only selection gets no group
  // item -- notes simply ride along when cards ARE present); Delete
  // covers every selected card + note together, instantly.
  const openMultiSelectMenu = (cardIDs: string[], noteIDs: string[], pos: { x: number; y: number }) => {
    const items: ContextMenuItem[] = []
    if (cardIDs.length >= 2) {
      items.push({ id: 'group', label: t('contextMenu.groupIntoArea'), commandId: 'atlas.group.selection', run: () => requestGroup(cardIDs, noteIDs, pos) })
    }
    // Notes never join a perspective (ADR-0041's MemberCardIDs is cards
    // only) -- only the selection's card ids are offered.
    const perspectiveItems = perspectiveMembershipMenuItems({ t, perspectives, cardIDs, pos, setMenu, onToast: onPerspectiveToast })
    if (perspectiveItems.length > 0) {
      if (items.length > 0) items.push({ id: 'd1', divider: true })
      items.push(...perspectiveItems)
      items.push({ id: 'd2', divider: true })
    }
    items.push({ id: 'delete-selection', label: t('contextMenu.delete'), commandId: 'atlas.delete.selection', danger: true, run: () => deleteSelection(cardIDs, noteIDs) })
    setMenu({ x: pos.x, y: pos.y, items })
  }

  return { openFrameMenu, openFrameInteriorMenu, openMultiSelectMenu, deleteSelection, dissolveDialog }
}
