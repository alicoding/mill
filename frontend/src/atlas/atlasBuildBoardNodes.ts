import type { Card, Kind, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'
import { computeAutoArrangeLayout, computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
import { computeFreshnessRollup } from './atlasCardPresentation'
import type { AtlasNoteCardRFNode } from './AtlasNoteCardNode'
import type { AtlasGroupRFNode } from './AtlasGroupNode'
import type { AtlasRegionChipRFNode } from './AtlasRegionChipNode'

export type BoardCardRFNode = AtlasNoteCardRFNode | AtlasGroupRFNode | AtlasRegionChipRFNode

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
export function buildBoardCardNodes({
  cards, allCards, kinds, links, linkKinds, isFree, readOnly, boardWidth, freeMoves, arteries,
  flippedID, pulsedID, hintedID, hoveredFrameID, toggleFlip, onOpenOverlay, handleDrill, handleLeafCommit,
}: {
  cards: Card[]
  allCards: Card[]
  kinds: Kind[]
  links: Link[]
  linkKinds: LinkKind[]
  isFree: boolean
  readOnly: boolean
  boardWidth: number
  freeMoves: { id: string; x: number; y: number }[]
  arteries: { source: string; target: string }[]
  flippedID: string | null
  pulsedID: string | null
  hintedID: string | null
  // Drag filing's own live release-target affordance (goal 0081 A2):
  // the frame currently under a dragged card's center, if any.
  hoveredFrameID: string | null
  toggleFlip: (id: string) => void
  onOpenOverlay: (id: string) => void
  handleDrill: (id: string) => void
  handleLeafCommit: (id: string) => void
}): BoardCardRFNode[] {
  const kindByID = new Map(kinds.map((k) => [k.ID, k]))
  const adjacency = new Map<string, string[]>()
  for (const a of arteries) {
    adjacency.set(a.source, [...(adjacency.get(a.source) ?? []), a.target])
    adjacency.set(a.target, [...(adjacency.get(a.target) ?? []), a.source])
  }
  const autoLayout = !isFree ? computeAutoArrangeLayout(cards, allCards, adjacency, boardWidth > 0 ? boardWidth - 48 : undefined) : null
  const moveByID = new Map(freeMoves.map((m) => [m.id, m]))
  const nodes: BoardCardRFNode[] = []

  const noteData = (card: Card) => ({
    card,
    kind: kindByID.get(card.KindID),
    allCards,
    links,
    linkKinds,
    flipped: flippedID === card.ID,
    pulsed: pulsedID === card.ID,
    hinted: hintedID === card.ID,
    onToggleFlip: toggleFlip,
    onOpenOverlay,
    onCommit: handleLeafCommit,
  })

  for (const card of cards) {
    const box = autoLayout?.boxes.get(card.ID)
    const move = moveByID.get(card.ID)
    const position = isFree
      ? { x: move?.x ?? card.Position?.X ?? 0, y: move?.y ?? card.Position?.Y ?? 0 }
      : { x: box?.x ?? 0, y: box?.y ?? 0 }

    if (isGroupCard(allCards, card)) {
      const frame = computeGroupFrameLayout(allCards, card.ID)
      const size = isFree ? frame.size : { width: box?.width ?? frame.size.width, height: box?.height ?? frame.size.height }
      const groupFlipped = flippedID === card.ID
      nodes.push({
        id: card.ID,
        type: 'atlas-group',
        position,
        width: size.width,
        height: size.height,
        draggable: isFree && !readOnly,
        data: {
          card,
          kind: kindByID.get(card.KindID),
          allCards,
          links,
          linkKinds,
          childCount: childrenOf(allCards, card.ID).length,
          // Roll-up covers EVERY direct child, drawn or capped -- the
          // pills stay the deep truth regardless of the preview.
          freshness: computeFreshnessRollup(childrenOf(allCards, card.ID)),
          overflow: frame.overflow,
          pulsed: pulsedID === card.ID,
          hinted: hintedID === card.ID,
          flipped: groupFlipped,
          dragHighlighted: hoveredFrameID === card.ID,
          onDrill: handleDrill,
          onToggleFlip: toggleFlip,
          onOpenOverlay,
        },
      })
      // A flipped frame's own back face must visually and
      // interactively cover its own preview children -- React Flow
      // always renders a parentId child at parentZ+1 minimum
      // (@xyflow/system's own calculateChildXYZ), so a parent node
      // can never out-z-index its own children; omitting the
      // children entirely while flipped is what actually achieves
      // "z above the children," not a z-index that RF's own child
      // stacking invariant would silently defeat.
      if (!groupFlipped) {
        for (const child of frame.children) {
          if (child.variant === 'chip') {
            nodes.push({
              id: child.card.ID,
              type: 'atlas-region-chip',
              position: child.position,
              width: child.size.width,
              height: child.size.height,
              parentId: card.ID,
              extent: 'parent',
              draggable: false,
              data: {
                card: child.card,
                kind: kindByID.get(child.card.KindID),
                childCount: childrenOf(allCards, child.card.ID).length,
                pulsed: pulsedID === child.card.ID,
                flipped: flippedID === child.card.ID,
                onToggleFlip: toggleFlip,
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
              extent: 'parent',
              draggable: false,
              data: noteData(child.card),
            })
          }
        }
      }
    } else {
      nodes.push({
        id: card.ID,
        type: 'atlas-note',
        position,
        width: NOTE_WIDTH,
        height: NOTE_HEIGHT,
        draggable: isFree && !readOnly,
        data: noteData(card),
      })
    }
  }
  return nodes
}
