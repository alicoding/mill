import { useEffect, useMemo, useRef } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { computeAutoArrangeLayout, computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
import { resolveFreeOverlaps } from './atlasOverlapResolution'
import type { resolveBoardEdges } from './atlasLinkResolution'

// Position-less cards (a nil Position -- the wire's null; a stored
// (0,0) is a REAL position, e.g. the arrange button's own first seat,
// and conflating the two re-exiled every arranged origin card below
// the board) get packer seats BELOW the positioned cards' extent,
// then overlap NUDGES apply on top -- and the result must carry the
// seats themselves, not only the resolver's nudges: resolveFreeOverlaps
// returns moves for overlapping boxes only (leaf-on-leaf deliberately
// untouched), so returning it alone silently dropped every seat and
// stacked all position-less cards at the zero value. Exported pure
// for its unit test.
export function computeFreeMoves(
  cards: Card[],
  allCards: Card[],
  arrangeAdjacency: Map<string, string[]>,
  boardWidth: number,
): { id: string; x: number; y: number }[] {
  const positioned = cards.filter((c) => c.Position != null)
  const unpositioned = cards.filter((c) => c.Position == null)
  const packed = unpositioned.length > 0
    ? computeAutoArrangeLayout(unpositioned, allCards, arrangeAdjacency, boardWidth > 0 ? boardWidth - 48 : undefined).boxes
    : new Map<string, { x: number; y: number }>()
  const maxY = positioned.reduce((m, c) => Math.max(m, (c.Position?.Y ?? 0) + (isGroupCard(allCards, c) ? computeGroupFrameLayout(allCards, c.ID).size.height : NOTE_HEIGHT)), 0)
  const yBase = positioned.length > 0 ? maxY + 48 : 0
  const seatedBoxes = cards.map((card) => {
    const frame = isGroupCard(allCards, card)
    const size = frame ? computeGroupFrameLayout(allCards, card.ID).size : { width: NOTE_WIDTH, height: NOTE_HEIGHT }
    const seat = packed.get(card.ID)
    return {
      id: card.ID,
      x: seat ? seat.x : (card.Position?.X ?? 0),
      y: seat ? seat.y + yBase : (card.Position?.Y ?? 0),
      width: size.width,
      height: size.height,
      isFrame: frame,
    }
  })
  const nudged = new Map(resolveFreeOverlaps(seatedBoxes).map((m) => [m.id, m]))
  const moves: { id: string; x: number; y: number }[] = []
  for (const box of seatedBoxes) {
    const n = nudged.get(box.id)
    const x = n?.x ?? box.x
    const y = n?.y ?? box.y
    const card = cards.find((c) => c.ID === box.id)
    // A nil-Position card's seat is always a move -- rendering has no
    // other source for it, even when the seat happens to be (0,0).
    if (card?.Position == null || x !== card.Position.X || y !== card.Position.Y) moves.push({ id: box.id, x, y })
  }
  return moves
}

// Positions-sovereign layout + the one-shot Auto-arrange action
// (goal 0089, split from AtlasBoard.tsx at the 500-line seam): every
// level renders Free; position-less cards get in-memory packer seats
// (assistance until the user takes control -- nothing persists from
// rendering); an arrangeRequest bump re-packs the level and persists.
export function useAtlasArrange({ cards, allCards, arteries, boardWidth, arrangeRequest }: {
  cards: Card[]
  allCards: Card[]
  arteries: ReturnType<typeof resolveBoardEdges>
  boardWidth: number
  arrangeRequest?: number
}) {
  // Both directions, the same shape atlasBuildBoardNodes derives for
  // the packer's link-adjacent ordering.
  const arrangeAdjacency = useMemo(() => {
    const adjacency = new Map<string, string[]>()
    for (const a of arteries) {
      adjacency.set(a.source, [...(adjacency.get(a.source) ?? []), a.target])
      adjacency.set(a.target, [...(adjacency.get(a.target) ?? []), a.source])
    }
    return adjacency
  }, [arteries])

  // In-memory ONLY -- rendering never writes positions. A render-path
  // persist raced the Auto-arrange button's own SetPosition batch
  // (stale seats computed from pre-arrange cards clobbered arranged
  // ones, last-writer-wins); persistence belongs to user actions
  // alone: a drag, or the arrange button below.
  const freeMoves = useMemo(
    () => computeFreeMoves(cards, allCards, arrangeAdjacency, boardWidth),
    [cards, allCards, arrangeAdjacency, boardWidth],
  )

  // The Auto-arrange BUTTON (goal 0089): one-shot packer over this
  // level, persisting every seat -- then control returns to the user.
  const lastArrangeRef = useRef(0)
  useEffect(() => {
    if (!arrangeRequest || arrangeRequest === lastArrangeRef.current) return
    // A freshly-mounted board (level change remounts it) hasn't been
    // measured yet -- packing at the fallback width wraps rows
    // differently than the real board. Leave the request unconsumed;
    // boardWidth is a dependency, so the measurement re-fires this.
    if (boardWidth <= 0) return
    lastArrangeRef.current = arrangeRequest
    const layout = computeAutoArrangeLayout(cards, allCards, arrangeAdjacency, boardWidth - 48).boxes
    void Promise.all(cards.map((c) => {
      const seat = layout.get(c.ID)
      return seat ? AtlasService.SetPosition(c.ID, { X: seat.x, Y: seat.y }) : Promise.resolve(null)
    })).then(() => refreshAtlas()).catch(console.error)
  }, [arrangeRequest, cards, allCards, arrangeAdjacency, boardWidth])

  return { freeMoves }
}
