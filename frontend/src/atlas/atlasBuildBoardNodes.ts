import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BoardObject, Card, Kind, Link, LinkKind, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'
import { computeAutoArrangeLayout, computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH, TABLE_HEIGHT, TABLE_WIDTH } from './atlasBoardLayout'
import { computeFreshnessRollup, computeRollupSummary } from './atlasCardPresentation'
import { type BoardFilter, filterIsActive, matchesBoardFilter } from './cardFilter'
import type { AtlasNoteCardRFNode } from './AtlasNoteCardNode'
import type { AtlasGroupRFNode } from './AtlasGroupNode'
import type { AtlasStickyRFNode } from './AtlasStickyNode'
import type { AtlasRegionChipRFNode } from './AtlasRegionChipNode'
import type { AtlasBoardObjectRFNode } from './AtlasBoardObjectNode'

export type BoardCardRFNode = AtlasNoteCardRFNode | AtlasGroupRFNode | AtlasRegionChipRFNode | AtlasStickyRFNode | AtlasBoardObjectRFNode

// The board's own card/frame/chip React Flow nodes -- pulled out of
// AtlasBoard.tsx's builtNodes memo (architecture.md's 500-line
// convention) since this is a self-contained, closure-free
// transformation from the Atlas domain model to React Flow's node
// shape. Auto-arrange positions (deterministic, never persisted) vs
// Free (saved Position, drag persists) is a parameter, not two
// functions; a card with children renders as a region frame
// (AtlasGroupNode) whose own direct children render as separate,
// non-draggable preview nodes anchored inside it (parentId +
// extent:'parent') -- one nesting level deep, regardless of board
// mode; a childless card renders as a flippable note (AtlasNoteCardNode).
// eslint-disable-next-line sonarjs/cognitive-complexity -- legacy complexity grandfathered at gate adoption; pay down when touched (goal 0109 burn-down)
export function buildBoardCardNodes({
  cards, allCards, allNotes, allObjects, kinds, links, linkKinds, isFree, readOnly, boardWidth, freeMoves, arteries,
  pulsedID, hintedID, isSoleSelected, onOpenOverlay, handleDrill,
  slotDragSourceID, onSlotAnchorPointerDown, hasLegalTargets, boardFilter,
  titleEditCardID, onTitleCommit, onTitleCancel, noteHandlers,
}: {
  cards: Card[]
  allCards: Card[]
  // Every note (not just this level's): a frame's preview draws the
  // stickies filed inside it, so a filed note stays visible from one
  // level up exactly like a filed card.
  allNotes: Note[]
  // Every board object, same reasoning (goal 0266): a frame's preview
  // draws the objects filed inside it.
  allObjects: BoardObject[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  isFree: boolean
  readOnly: boolean
  boardWidth: number
  freeMoves: { id: string; x: number; y: number }[]
  arteries: { source: string; target: string }[]
  pulsedID: string | null
  hintedID: string | null
  // The click model's own commit test (goal 0102's gesture table):
  // whether a given node id was the SOLE selected node when the
  // current click gesture began -- see useAtlasSelection.ts's own
  // header comment.
  isSoleSelected: (id: string) => boolean
  onOpenOverlay: (id: string) => void
  handleDrill: (id: string) => void
  // Slot-drag's own live release-target affordance (goal 0081 A4): the
  // card a slot-drag started FROM, if any -- every OTHER top-level
  // card highlights while it's non-null (slice A's all-answer rule).
  slotDragSourceID: string | null
  onSlotAnchorPointerDown: (cardID: string, linkKindID: string, e: ReactPointerEvent) => void
  // Handle honesty (goal 0124 slice 2): whether at least one other
  // linkable card exists anywhere on this board -- false disables
  // every card's own link handle rather than offering a drag that can
  // never connect.
  hasLegalTargets: boolean
  // The board filter (goal 0129 slice 1): leaf cards outside the
  // match DIM in place; frames never dim (structure, not results).
  boardFilter: BoardFilter
  titleEditCardID: string | null
  onTitleCommit: (id: string, title: string) => void
  onTitleCancel: () => void
  // The sticky components' own edit/commit contract, shared with
  // buildStickyNodes so a preview note edits like a level note.
  noteHandlers: {
    editingNoteID: string | null
    onEnterEdit: (id: string) => void
    onCancelEdit: () => void
    onCommitEdit: (id: string, text: string) => void
    onOpenNote: (id: string) => void
  }
}): BoardCardRFNode[] {
  const kindByID = new Map(kinds.map((k) => [k.ID, k]))
  const adjacency = new Map<string, string[]>()
  for (const a of arteries) {
    adjacency.set(a.source, [...(adjacency.get(a.source) ?? []), a.target])
    adjacency.set(a.target, [...(adjacency.get(a.target) ?? []), a.source])
  }
  const autoLayout = !isFree ? computeAutoArrangeLayout(cards, allCards, adjacency, boardWidth > 0 ? boardWidth - 48 : undefined, allNotes, [], allObjects) : null
  const moveByID = new Map(freeMoves.map((m) => [m.id, m]))
  const nodes: BoardCardRFNode[] = []

  // A slot-drag started FROM this card never highlights ITSELF (LOCKED
  // design §3: "every OTHER top-level card lifts").
  const slotDragHighlight = (id: string) => slotDragSourceID !== null && slotDragSourceID !== id

  const filterActive = filterIsActive(boardFilter)
  const noteData = (card: Card) => ({
    card,
    dimmed: filterActive && !matchesBoardFilter(card, boardFilter),
    kind: kindByID.get(card.KindID),
    allCards,
    links,
    linkKinds,
    pulsed: pulsedID === card.ID,
    hinted: hintedID === card.ID,
    isSoleSelected,
    slotDragHighlight: slotDragHighlight(card.ID),
    hasLegalTargets,
    onCommit: onOpenOverlay,
    onDrill: handleDrill,
    onSlotAnchorPointerDown: (linkKindID: string, e: ReactPointerEvent) => onSlotAnchorPointerDown(card.ID, linkKindID, e),
    titleEditing: card.ID === titleEditCardID,
    onTitleCommit,
    onTitleCancel,
  })

  for (const card of cards) {
    const box = autoLayout?.boxes.get(card.ID)
    const move = moveByID.get(card.ID)
    const position = isFree
      ? { x: move?.x ?? card.Position?.X ?? 0, y: move?.y ?? card.Position?.Y ?? 0 }
      : { x: box?.x ?? 0, y: box?.y ?? 0 }

    if (isGroupCard(allCards, card, allNotes, allObjects)) {
      const frame = computeGroupFrameLayout(allCards, card.ID, allNotes, allObjects)
      const size = isFree ? frame.size : { width: box?.width ?? frame.size.width, height: box?.height ?? frame.size.height }
      nodes.push({
        id: card.ID,
        type: 'atlas-group',
        position,
        width: size.width,
        height: size.height,
        draggable: isFree && !readOnly,
        data: {
          card,
          // Every filed member counts, not only cards (goal 0266's
          // peer law; the label reads "items").
          childCount: childrenOf(allCards, card.ID).length + allNotes.filter((n) => n.ParentID === card.ID).length + allObjects.filter((o) => o.ParentID === card.ID).length,
          // Roll-up covers EVERY direct child, drawn or capped -- the
          // pills stay the deep truth regardless of the preview.
          freshness: computeFreshnessRollup(childrenOf(allCards, card.ID)),
          // The field-aware "<done> of <total>" rollup (docs/goals/0164
          // L3), same EVERY-direct-child scope as freshness above --
          // null when no child's Kind declares a rollup field.
          rollup: computeRollupSummary(childrenOf(allCards, card.ID), kindByID),
          overflow: frame.overflow,
          pulsed: pulsedID === card.ID,
          hinted: hintedID === card.ID,
          isSoleSelected,
          // A region frame is a legal link target too (goal 0124
          // slice 2) -- highlight it the same way a leaf card
          // highlights, so "drop anywhere on a highlighted card"
          // stays true for areas as well as components.
          slotDragHighlight: slotDragHighlight(card.ID),
          onDrill: handleDrill,
          onOpenOverlay,
        },
      })
      for (const sticky of frame.stickies) {
        nodes.push({
          id: sticky.note.ID,
          type: 'atlas-sticky',
          position: sticky.position,
          width: sticky.size.width,
          height: sticky.size.height,
          parentId: card.ID,
          // The preview grid is never draggable (this function's own
          // header contract); note drag-out from a preview is a named
          // deferral in goal 0153's record.
          draggable: false,
          data: {
            note: sticky.note,
            editing: noteHandlers.editingNoteID === sticky.note.ID,
            // A preview note commits on click-away in every save mode
            // (its slot renders the saved note, never a held text):
            // goal 0295's own deferral record.
            dirty: false,
            isSoleSelected,
            onCommit: (text: string) => noteHandlers.onCommitEdit(sticky.note.ID, text),
            onSave: (text: string) => noteHandlers.onCommitEdit(sticky.note.ID, text),
            onCancelEdit: noteHandlers.onCancelEdit,
            onEnterEdit: () => noteHandlers.onEnterEdit(sticky.note.ID),
            onOpenBig: () => noteHandlers.onOpenNote(sticky.note.ID),
            // This preview tile is a fixed uniform grid slot (this
            // function's own header contract: "never reads a child's
            // own Size"), never content-driven the way a top-level
            // sticky is -- clamps to the slot instead of growing past
            // it and breaking the grid.
            previewHeight: sticky.size.height,
          },
        })
      }
      // Filed board objects preview as their REAL faces in a slot
      // (goal 0266) -- inert: `preview` suppresses the drag band, the
      // edit double-click, and content pointer capture so a diagram's
      // own viewer can't swallow frame clicks.
      for (const filed of frame.objects) {
        nodes.push({
          id: filed.object.ID,
          type: 'atlas-object',
          position: filed.position,
          width: filed.size.width,
          height: filed.size.height,
          parentId: card.ID,
          draggable: false,
          data: { object: filed.object, soleSelected: false, preview: true },
        })
      }
      for (const child of frame.children) {
        if (child.variant === 'chip') {
          nodes.push({
            id: child.card.ID,
            type: 'atlas-region-chip',
            position: child.position,
            width: child.size.width,
            height: child.size.height,
            parentId: card.ID,
            // Drag-out re-parenting (goal 0141): a frame child is
            // draggable in Free mode and NOT clamped to its parent --
            // crossing the frame's edge is how it leaves.
            draggable: isFree && !readOnly,
            data: {
              card: child.card,
              kind: kindByID.get(child.card.KindID),
              childCount: childrenOf(allCards, child.card.ID).length + allNotes.filter((n) => n.ParentID === child.card.ID).length + allObjects.filter((o) => o.ParentID === child.card.ID).length,
              rollup: computeRollupSummary(childrenOf(allCards, child.card.ID), kindByID),
              pulsed: pulsedID === child.card.ID,
              isSoleSelected,
              onOpenOverlay,
              onDrill: handleDrill,
            },
          })
        } else {
          nodes.push({
            id: child.card.ID,
            type: 'atlas-note',
            position: child.position,
            width: child.size.width,
            height: child.size.height,
            parentId: card.ID,
            draggable: isFree && !readOnly,
            data: noteData(child.card),
          })
        }
      }
    } else if (card.ProjectionListID) {
      // A List projection's full table face (goal 0105); the arrange
      // packer places it at this same real footprint
      // (computeAutoArrangeLayout's own projection branch). Inside a
      // region frame's preview it still renders as a note face with
      // the table chip -- the frame's child boxes are uniform.
      nodes.push({
        id: card.ID,
        type: 'atlas-table',
        position,
        // A persisted resize (Card.Size) wins over the default face.
        width: card.Size?.W ?? TABLE_WIDTH,
        height: card.Size?.H ?? TABLE_HEIGHT,
        draggable: isFree && !readOnly,
        data: noteData(card),
      })
    } else {
      nodes.push({
        id: card.ID,
        type: 'atlas-note',
        position,
        // A persisted resize (Card.Size) wins over the default face
        // (goal 0193) -- same contract as the table branch above.
        width: card.Size?.W ?? NOTE_WIDTH,
        height: card.Size?.H ?? NOTE_HEIGHT,
        draggable: isFree && !readOnly,
        data: noteData(card),
      })
    }
  }
  return nodes
}
