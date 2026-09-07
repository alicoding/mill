import { useCallback, useState } from 'react'
import type { TFunction } from 'i18next'
import type { Card, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { runCommand } from '../shared/commands'
import { AtlasService } from '../shared/bindings'
import { background } from '../shared/background'
import { atlasSelectionContext } from '../shared/atlasSelectionStore'
import { atlasFacts } from '../shared/atlasSelectionFacts'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { AtlasEdgeLabelPopover } from './AtlasEdgeLabelPopover'
import { perspectiveMembershipMenuItems } from './atlasPerspectiveMenuItems'

type Pos = { x: number; y: number }

// AtlasView's own card + edge context menus (goal 0081 slice A4,
// LOCKED design §6d) -- split out of AtlasView.tsx (architecture.md's
// 500-line convention). Every item is a registry command over the
// selection context (goal 0346 slice B): this hook decides WHICH card
// or link an item names and where the click was; the command decides
// its label, whether it is offered, and what it does. A mirror-path
// card leads with kind-aware verbs (Open file/Reveal in file manager)
// before Zoom/Open/share/Delete; an edge gains Change link kind/Edit
// label/Remove link, gated by the command to a single link (an
// aggregated artery is not one link).
export function useAtlasLinkMenus({ t, allCards, linkKinds, setMenu }: {
  t: TFunction<'atlas'>
  allCards: Card[]
  linkKinds: LinkKind[]
  setMenu: (state: ContextMenuState | null) => void
}) {
  const [labelTarget, setLabelTarget] = useState<{ linkID: string; pos: Pos; initialLabel: string } | null>(null)

  const cardContext = (cardID: string, pos: Pos) => atlasSelectionContext({ cards: [cardID], notes: [], objects: [], links: [] }, { pos })

  const openCardMenu = (cardID: string, pos: Pos) => {
    const card = allCards.find((c) => c.ID === cardID)
    if (!card) return
    const ctx = cardContext(cardID, pos)
    // Export-as (ADR-0043 §3): one format downloads directly; several
    // open as a submenu naming each -- the command's own label says
    // which, and the same command serves the card page's kebab.
    const exporters = atlasFacts().card(cardID)?.exporters ?? []
    const exportItems: ContextMenuItem[] = exporters.length > 1
      ? [{ id: 'export-as', label: t('export.menuLabel'), submenu: exporters.map((e) => ({ id: `export-${e.format}`, commandId: 'atlas.card.exportAs', ctx: atlasSelectionContext({ cards: [cardID], notes: [], objects: [], links: [] }, { pos, format: e.format }) })) }]
      : [{ id: 'export-as', commandId: 'atlas.card.exportAs', ctx }]
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        { id: 'open-file', commandId: 'atlas.card.openFile', ctx },
        { id: 'reveal-in-file-manager', commandId: 'atlas.card.revealInFileManager', ctx },
        { id: 'd0', divider: true },
        ...exportItems,
        { id: 'd0c', divider: true },
        { id: 'add-linked-card', commandId: 'atlas.card.addLinkedCard', ctx },
        { id: 'd0b', divider: true },
        { id: 'zoom', commandId: 'atlas.card.zoomIn', ctx },
        { id: 'open', commandId: 'atlas.card.open', ctx },
        { id: 'fit-to-content', commandId: 'atlas.card.fitToContent', ctx },
        { id: 'd1', divider: true },
        { id: 'copy-context', commandId: 'atlas.card.copyContext', ctx },
        { id: 'copy-link', commandId: 'atlas.card.copyLink', ctx },
        { id: 'd1b', divider: true },
        ...perspectiveMembershipMenuItems({ t, cardIDs: [card.ID] }),
        { id: 'd2', divider: true },
        { id: 'delete', commandId: 'atlas.delete.selection', ctx, danger: true },
      ],
    })
  }

  // Reused by both the right-click artery menu's Remove link item AND
  // the edge hover chip's own Delete button (goal 0124 slice 2) --
  // single source of truth for the action rather than two copies.
  // useCallback-stable: AtlasBoard's own edges memo takes this as a
  // dependency, and an unstable reference here rebuilt the whole
  // edges array on every unrelated AtlasView render.
  const linkContext = (linkID: string, pos?: Pos, target?: { card?: string; linkKind?: string }) =>
    atlasSelectionContext({ cards: [], notes: [], objects: [], links: [linkID] }, { pos, ...target })

  const removeLink = useCallback((linkID: string) => {
    void runCommand('atlas.link.remove', linkContext(linkID))
  }, [])

  const kindItems = useCallback((linkID: string, pos: Pos): ContextMenuItem[] => linkKinds.map((lk): ContextMenuItem => ({
    id: lk.ID,
    commandId: 'atlas.link.setKind',
    ctx: linkContext(linkID, pos, { linkKind: lk.ID }),
  })), [linkKinds])

  const openChangeKindMenu = useCallback((linkID: string, pos: Pos) => {
    setMenu({ x: pos.x, y: pos.y, items: kindItems(linkID, pos) })
  }, [kindItems, setMenu])

  const openArteryMenu = (sourceID: string, targetID: string, linkID: string, count: number, pos: Pos) => {
    const items: ContextMenuItem[] = [
      { id: 'open-source', commandId: 'atlas.card.open', ctx: linkContext(linkID, pos, { card: sourceID }) },
      { id: 'open-target', commandId: 'atlas.card.open', ctx: linkContext(linkID, pos, { card: targetID }) },
    ]
    // Acting on one specific link within a count>1 aggregated artery
    // has no per-link picker: the link items name the artery's own id
    // only when it IS one link.
    if (count === 1) {
      const ctx = linkContext(linkID, pos)
      items.push(
        { id: 'd1', divider: true },
        { id: 'change-kind', label: t('contextMenu.changeLinkKind'), submenu: kindItems(linkID, pos) },
        { id: 'edit-label', commandId: 'atlas.link.editLabel', ctx },
        { id: 'remove-link', commandId: 'atlas.link.remove', ctx, danger: true },
      )
    }
    setMenu({ x: pos.x, y: pos.y, items })
  }

  // The label popover the atlas.link.editLabel request opens.
  const editLabel = (linkID: string, pos: Pos) => {
    setLabelTarget({ linkID, pos, initialLabel: atlasFacts().link(linkID)?.label ?? '' })
  }

  const labelPopover = labelTarget && (
    <AtlasEdgeLabelPopover
      anchorPos={labelTarget.pos}
      initialLabel={labelTarget.initialLabel}
      onSubmit={(label) => {
        const linkID = labelTarget.linkID
        setLabelTarget(null)
        void background(AtlasService.UpdateLink(linkID, label), 'atlas.link.updateLabel')
      }}
      onCancel={() => setLabelTarget(null)}
    />
  )

  return { openCardMenu, openArteryMenu, labelPopover, removeLink, openChangeKindMenu, editLabel }
}
