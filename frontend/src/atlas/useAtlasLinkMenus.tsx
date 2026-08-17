import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { Card, Link, LinkKind, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { isGroupCard } from './atlasBoardLayout'
import { atlasCardShareActions } from './atlasCardShare'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { AtlasEdgeLabelPopover } from './AtlasEdgeLabelPopover'

const ARTERY_MENU_TITLE_MAX = 28

// An artery's own right-click labels ("Open <title>") stay one line
// regardless of how long the connected card's title is.
function truncateTitle(title: string): string {
  return title.length > ARTERY_MENU_TITLE_MAX ? `${title.slice(0, ARTERY_MENU_TITLE_MAX - 1)}…` : title
}

// AtlasView's own card + edge context menus (goal 0081 slice A4,
// LOCKED design §6d) -- split out of AtlasView.tsx (architecture.md's
// 500-line convention), extending goal 0075's original pair: a
// mirror-path card leads with kind-aware verbs (Open file/Reveal in
// file manager) before the existing Zoom/Open/share/Delete block,
// every card gets "Add linked card…", and an edge gains Change link
// kind/Edit label/Remove link -- gated to a NON-aggregated edge
// (count === 1), since acting on one specific link within a count>1
// aggregated artery has no per-link picker in this slice.
export function useAtlasLinkMenus({
  t, allCards, allLinks, allNotes, linkKinds, setMenu, drill, onOpenCard, onError, requestLinkedCard,
}: {
  t: TFunction<'atlas'>
  allCards: Card[]
  allLinks: Link[]
  allNotes: Note[]
  linkKinds: LinkKind[]
  setMenu: (state: ContextMenuState | null) => void
  drill: (id: string) => void
  onOpenCard: (id: string) => void
  onError: (message: string) => void
  requestLinkedCard: (fromCardID: string, pos: { x: number; y: number }) => void
}) {
  const [labelTarget, setLabelTarget] = useState<{ linkID: string; pos: { x: number; y: number }; initialLabel: string } | null>(null)

  const { requestDelete, dialog: menuDeleteDialog } = useConfirmDelete<Card>({
    entityType: 'card',
    labelOf: (c) => c.Title,
    onConfirm: (c) => {
      AtlasService.DeleteCard(c.ID).catch((err) => onError(String(err)))
    },
  })

  const openCardMenu = (cardID: string, pos: { x: number; y: number }) => {
    const card = allCards.find((c) => c.ID === cardID)
    if (!card) return
    const share = atlasCardShareActions(card, onError)
    // isGroupCard only counts Card children -- a card holding ONLY
    // Notes (the seeded Scratchpad inbox, docs/goals/0090) still needs
    // its own Zoom-in door, since a Note's containment is otherwise
    // unreachable from the board (visibleNotes only renders once
    // viewedID equals the note's own ParentID).
    const place = isGroupCard(allCards, card) || allNotes.some((n) => n.ParentID === card.ID)
    const mirrorItems: ContextMenuItem[] = card.MirrorPath
      ? [
          { id: 'open-file', label: t('contextMenu.openFile'), run: () => void AtlasService.OpenCardMirror(card.ID).catch((err) => onError(String(err))) },
          { id: 'reveal-in-file-manager', label: t('contextMenu.revealInFileManager'), run: () => void AtlasService.RevealCardMirror(card.ID).catch((err) => onError(String(err))) },
          { id: 'd0', divider: true },
        ]
      : []
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        ...mirrorItems,
        { id: 'add-linked-card', label: t('contextMenu.addLinkedCard'), run: () => requestLinkedCard(card.ID, pos) },
        { id: 'd0b', divider: true },
        ...(place ? [{ id: 'zoom', label: t('contextMenu.zoomIn'), run: () => drill(card.ID) }] : []),
        { id: 'open', label: t('contextMenu.open'), run: () => onOpenCard(card.ID) },
        { id: 'd1', divider: true },
        { id: 'copy-context', label: t('share.copyContext'), run: () => void share.copyAsContext(false) },
        { id: 'copy-link', label: t('share.copyCloudLink'), run: () => void share.copyCloudLink() },
        ...(card.MirrorPath ? [{ id: 'reveal', label: t('share.revealFile'), run: () => void share.revealFile() }] : []),
        { id: 'd2', divider: true },
        { id: 'delete', label: t('overlay.delete'), danger: true, run: () => requestDelete(card) },
      ],
    })
  }

  const openChangeKindMenu = (linkID: string, pos: { x: number; y: number }) => {
    setMenu({
      x: pos.x,
      y: pos.y,
      items: linkKinds.map((lk): ContextMenuItem => ({
        id: lk.ID,
        label: lk.Label,
        run: () => void AtlasService.SetLinkKind(linkID, lk.ID).catch((err) => onError(String(err))),
      })),
    })
  }

  const openArteryMenu = (sourceID: string, targetID: string, linkID: string, count: number, pos: { x: number; y: number }) => {
    const source = allCards.find((c) => c.ID === sourceID)
    const target = allCards.find((c) => c.ID === targetID)
    if (!source || !target) return
    const items: ContextMenuItem[] = [
      { id: 'open-source', label: t('contextMenu.openCard', { title: truncateTitle(source.Title) }), run: () => onOpenCard(source.ID) },
      { id: 'open-target', label: t('contextMenu.openCard', { title: truncateTitle(target.Title) }), run: () => onOpenCard(target.ID) },
    ]
    if (count === 1) {
      const link = allLinks.find((l) => l.ID === linkID)
      items.push(
        { id: 'd1', divider: true },
        { id: 'change-kind', label: t('contextMenu.changeLinkKind'), run: () => openChangeKindMenu(linkID, pos) },
        { id: 'edit-label', label: t('contextMenu.editLabel'), run: () => setLabelTarget({ linkID, pos, initialLabel: link?.Label ?? '' }) },
        { id: 'remove-link', label: t('contextMenu.removeLink'), danger: true, run: () => void AtlasService.DeleteLink(linkID).catch((err) => onError(String(err))) },
      )
    }
    setMenu({ x: pos.x, y: pos.y, items })
  }

  const labelPopover = labelTarget && (
    <AtlasEdgeLabelPopover
      anchorPos={labelTarget.pos}
      initialLabel={labelTarget.initialLabel}
      onSubmit={(label) => {
        const linkID = labelTarget.linkID
        setLabelTarget(null)
        void AtlasService.UpdateLink(linkID, label).catch((err) => onError(String(err)))
      }}
      onCancel={() => setLabelTarget(null)}
    />
  )

  return { openCardMenu, openArteryMenu, menuDeleteDialog, labelPopover }
}
