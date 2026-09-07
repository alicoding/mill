import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { BoardObject, Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { childrenOf } from './atlasGrouping'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { atlasSelectionContext } from '../shared/atlasSelectionStore'
import { perspectiveMembershipMenuItems } from './atlasPerspectiveMenuItems'

type Pos = { x: number; y: number }

// AtlasView's own frame/multi-select context menus (goal 0081 slice
// A2, LOCKED design §6d + item 4's dissolve rule) -- split out of
// AtlasView.tsx (architecture.md's 500-line convention). Every item is
// a registry command over the selection context (goal 0346 slice B);
// this hook keeps the two executors the commands' requests land on:
// deleteSelection (the container-delete gate, the one undo mark, the
// undo toast) and dissolve (the confirm naming the promotion).
//
// Delete goes instant everywhere (goal 0093's quick-delete-with-undo
// guard). Dissolve area keeps its confirm (a structure rewrite, not a
// delete): DeleteCard promotes a frame's children VIRTUALLY on delete
// regardless of which door triggered it, so "Dissolve area" and a
// plain Delete on a frame call the exact same AtlasService.DeleteCard
// -- only Dissolve's own confirm copy names the act deliberately.
export function useAtlasContainmentMenus({
  t, allCards, notes, allObjects, setMenu, onError, onDeleted, guardDelete,
}: {
  t: TFunction<'atlas'>
  allCards: Card[]
  notes: Note[]
  allObjects: BoardObject[]
  setMenu: (state: ContextMenuState | null) => void
  onError: (message: string) => void
  onDeleted: (result: TombstoneResult) => void
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

  const dissolve = (frameID: string) => {
    const frame = allCards.find((c) => c.ID === frameID)
    if (frame) setDissolveTarget(frame)
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

  const frameContext = (frameID: string, pos: Pos) => atlasSelectionContext({ cards: [frameID], notes: [], objects: [], links: [] }, { pos })

  // Frame interior empty space (LOCKED design §6d): the click point's
  // own frame is the parent, always named in the item -- never a bare
  // "Add card"/"Add note" once a frame is the destination.
  const openFrameInteriorMenu = (frameID: string, pos: Pos) => {
    const ctx = frameContext(frameID, pos)
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'add-card-inside', commandId: 'atlas.board.addCard', ctx },
        { id: 'add-note-inside', commandId: 'atlas.board.addNote', ctx },
      ],
    })
  }

  // A frame's own header/border (LOCKED design §6d): the full frame
  // menu -- mirror actions (a folder import only, goal 0178 S2),
  // add-inside, zoom, dissolve, delete, in that order.
  const openFrameMenu = (frameID: string, pos: Pos) => {
    const ctx = frameContext(frameID, pos)
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'reveal-in-file-manager', commandId: 'atlas.card.revealInFileManager', ctx },
        { id: 'refresh-from-folder', commandId: 'atlas.card.refreshFromFolder', ctx },
        { id: 'd0', divider: true },
        { id: 'add-card-inside', commandId: 'atlas.board.addCard', ctx },
        { id: 'zoom', commandId: 'atlas.card.zoomIn', ctx },
        { id: 'd1', divider: true },
        { id: 'dissolve', commandId: 'atlas.card.dissolve', ctx },
        { id: 'delete', commandId: 'atlas.delete.selection', ctx, danger: true },
      ],
    })
  }

  // A multi-selection (LOCKED design §6d): "Group into new area" only
  // once ANY 2+ placed things are selected (goal 0266's peer law:
  // cards, notes and board objects all group); Delete covers every
  // selected card + note + board object together, instantly. The
  // picture commands (docs/goals/0201) act on the board's own live
  // selection, so they carry no target.
  const openMultiSelectMenu = (cardIDs: string[], noteIDs: string[], objectIDs: string[], pos: Pos) => {
    const ctx = atlasSelectionContext({ cards: cardIDs, notes: noteIDs, objects: objectIDs, links: [] }, { pos })
    const items: ContextMenuItem[] = [
      { id: 'group', commandId: 'atlas.group.selection', ctx },
      { id: 'd-image', divider: true },
      { id: 'copy-as-image', commandId: 'atlas.selection.copyAsImage' },
      { id: 'export-as-image', commandId: 'atlas.selection.exportAsImage' },
      { id: 'd1', divider: true },
      // Notes never join a perspective (ADR-0041's MemberCardIDs is
      // cards only) -- only the selection's card ids are offered.
      ...perspectiveMembershipMenuItems({ t, cardIDs }),
      { id: 'd2', divider: true },
      { id: 'delete-selection', commandId: 'atlas.delete.selection', ctx, danger: true },
    ]
    setMenu({ x: pos.x, y: pos.y, items })
  }

  return { openFrameMenu, openFrameInteriorMenu, openMultiSelectMenu, deleteSelection, dissolve, dissolveDialog }
}
