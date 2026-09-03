import { useCallback, useState } from 'react'
import type { TFunction } from 'i18next'
import type { BoardObject, Card, Link, LinkKind, Note, Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { TombstoneResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { isGroupCard } from './atlasBoardLayout'
import { atlasCardShareActions } from './atlasCardShare'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { AtlasEdgeLabelPopover } from './AtlasEdgeLabelPopover'
import { perspectiveMembershipMenuItems } from './atlasPerspectiveMenuItems'
import { buildExportMenuChoice, runCardExport } from './atlasCardExportMenu'
import type { UnitExporter } from './unitRegistry'

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
  t, allCards, allLinks, allNotes, allObjects, linkKinds, perspectives, setMenu, drill, onOpenCard, onError, onDeleted, onPerspectiveToast, requestLinkedCard, guardDelete,
}: {
  t: TFunction<'atlas'>
  allCards: Card[]
  allLinks: Link[]
  allNotes: Note[]
  allObjects: BoardObject[]
  linkKinds: LinkKind[]
  perspectives: Perspective[]
  setMenu: (state: ContextMenuState | null) => void
  drill: (id: string) => void
  onOpenCard: (id: string) => void
  onError: (message: string) => void
  onDeleted: (result: TombstoneResult) => void
  onPerspectiveToast: (message: string) => void
  requestLinkedCard: (fromCardID: string, pos: { x: number; y: number }) => void
  // The container-delete gate (goal 0149 gap 3).
  guardDelete: (cardIDs: string[], noteIDs: string[], exec: () => void) => void
}) {
  const [labelTarget, setLabelTarget] = useState<{ linkID: string; pos: { x: number; y: number }; initialLabel: string } | null>(null)

  // Instant, no confirm (goal 0093's quick-delete-with-undo guard) --
  // onDeleted reports the TombstoneResult to AtlasView's shared undo
  // toast.
  const deleteCard = (id: string) => guardDelete([id], [], () => {
    AtlasService.DeleteCard(id)
      .then((result) => { onDeleted(result); void refreshAtlas() })
      .catch((err) => onError(String(err)))
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
    const place = isGroupCard(allCards, card, allNotes, allObjects)
    const perspectiveItems = perspectiveMembershipMenuItems({ t, perspectives, cardIDs: [card.ID], pos, setMenu, onToast: onPerspectiveToast })
    const mirrorItems: ContextMenuItem[] = card.MirrorPath
      ? [
          { id: 'open-file', label: t('contextMenu.openFile'), run: () => void AtlasService.OpenCardMirror(card.ID).catch((err) => onError(String(err))) },
          { id: 'reveal-in-file-manager', label: t('contextMenu.revealInFileManager'), run: () => void AtlasService.RevealCardMirror(card.ID).catch((err) => onError(String(err))) },
          { id: 'd0', divider: true },
        ]
      : []
    // Export-as (ADR-0043 §3, goal 0133 slice E1): buildExportMenuChoice
    // is the single source deciding whether this shows at all and
    // whether it's a direct download or a format submenu -- the card
    // page's kebab menu (AtlasCardOverlay) resolves the identical
    // choice off the same card, so the two surfaces can never drift.
    const exportChoice = buildExportMenuChoice({
      card,
      t,
      onDownload: (exporter) => void runCardExport(card, exporter, onError),
      onOpenFormats: (exporters: UnitExporter[]) => setMenu({
        x: pos.x,
        y: pos.y,
        items: exporters.map((exp): ContextMenuItem => ({ id: `export-${exp.format}`, label: exp.label, run: () => void runCardExport(card, exp, onError) })),
      }),
    })
    const exportItems: ContextMenuItem[] = exportChoice ? [{ id: exportChoice.id, label: exportChoice.label, run: exportChoice.run }, { id: 'd0c', divider: true }] : []
    // Fit to content (goal 0193's "expand to the point you can see the
    // remaining content", expressed as one action rather than a mode):
    // only the plain note face has content that clips by a fixed line
    // count -- a frame's box is computed from its children and a
    // table's from its rows, neither of which this measures.
    const fitToContentItem: ContextMenuItem[] = !isGroupCard(allCards, card, allNotes, allObjects) && !card.ProjectionListID
      ? [{
          id: 'fit-to-content',
          label: t('contextMenu.fitToContent'),
          run: () => {
            const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${card.ID}"] [data-testid="atlas-note-card"]`)
            if (!el) return
            // scrollHeight under a temporary height:auto is this card's
            // true natural content height (flex children with
            // min-height:0 collapse to nothing left to grow into once
            // the parent itself has no fixed height) -- overflow:clip
            // still reports it correctly, it just never PAINTS past the
            // box while clamped.
            const previousHeight = el.style.height
            el.style.height = 'auto'
            const naturalHeight = el.scrollHeight
            el.style.height = previousHeight
            void AtlasService.SetCardSize(card.ID, el.offsetWidth, naturalHeight)
          },
        }]
      : []
    setMenu({
      x: pos.x,
      y: pos.y,
      items: [
        ...mirrorItems,
        ...exportItems,
        { id: 'add-linked-card', label: t('contextMenu.addLinkedCard'), run: () => requestLinkedCard(card.ID, pos) },
        { id: 'd0b', divider: true },
        ...(place ? [{ id: 'zoom', label: t('contextMenu.zoomIn'), run: () => drill(card.ID) }] : []),
        { id: 'open', label: t('contextMenu.open'), run: () => onOpenCard(card.ID) },
        ...fitToContentItem,
        { id: 'd1', divider: true },
        { id: 'copy-context', label: t('share.copyContext'), run: () => void share.copyAsContext(false) },
        { id: 'copy-link', label: t('share.copyCloudLink'), run: () => void share.copyCloudLink() },
        ...(card.MirrorPath ? [{ id: 'reveal', label: t('share.revealFile'), run: () => void share.revealFile() }] : []),
        ...(perspectiveItems.length > 0 ? [{ id: 'd1b', divider: true } as ContextMenuItem, ...perspectiveItems] : []),
        { id: 'd2', divider: true },
        { id: 'delete', label: t('overlay.delete'), danger: true, run: () => deleteCard(card.ID) },
      ],
    })
  }

  // Reused by both the right-click artery menu's Remove link item AND
  // the edge hover chip's own Delete button (goal 0124 slice 2) --
  // single source of truth for the action rather than two copies.
  // useCallback-stable: AtlasBoard's own edges memo takes this as a
  // dependency, and an unstable reference here rebuilt the whole
  // edges array on every unrelated AtlasView render.
  const removeLink = useCallback((linkID: string) => {
    void AtlasService.DeleteLink(linkID).catch((err) => onError(String(err)))
  }, [onError])

  const openChangeKindMenu = useCallback((linkID: string, pos: { x: number; y: number }) => {
    setMenu({
      x: pos.x,
      y: pos.y,
      items: linkKinds.map((lk): ContextMenuItem => ({
        id: lk.ID,
        label: lk.Label,
        run: () => void AtlasService.SetLinkKind(linkID, lk.ID).catch((err) => onError(String(err))),
      })),
    })
  }, [linkKinds, setMenu, onError])

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
        { id: 'remove-link', label: t('contextMenu.removeLink'), danger: true, run: () => removeLink(linkID) },
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

  return { openCardMenu, openArteryMenu, labelPopover, removeLink, openChangeKindMenu }
}
