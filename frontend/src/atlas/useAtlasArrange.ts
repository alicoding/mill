import { useEffect, useMemo, useRef } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { computeAutoArrangeLayout, computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
import { resolveFreeOverlaps } from './atlasOverlapResolution'
import type { resolveBoardEdges } from './atlasLinkResolution'

// Position-less cards (legacy auto-arrange children, zero-value
// Position) get packer seats BELOW the positioned cards' extent, then
// overlap NUDGES apply on top -- and the result must carry the seats
// themselves, not only the resolver's nudges: resolveFreeOverlaps
// returns moves for overlapping boxes only (leaf-on-leaf deliberately
// untouched), so returning it alone silently dropped every seat and
// stacked all position-less cards at the zero value. Seats offset by
// 24 when nothing is positioned so no card ever lands exactly on the
// ambiguous zero-value Position. Exported pure for its unit test.
export function computeFreeMoves(
  cards: Card[],
  allCards: Card[],
  arrangeAdjacency: Map<string, string[]>,
  boardWidth: number,
): { id: string; x: number; y: number }[] {
  const positioned = cards.filter((c) => (c.Position?.X ?? 0) !== 0 || (c.Position?.Y ?? 0) !== 0)
  const unpositioned = cards.filter((c) => (c.Position?.X ?? 0) === 0 && (c.Position?.Y ?? 0) === 0)
  const packed = unpositioned.length > 0
    ? computeAutoArrangeLayout(unpositioned, allCards, arrangeAdjacency, boardWidth > 0 ? boardWidth - 48 : undefined).boxes
    : new Map<string, { x: number; y: number }>()
  const maxY = positioned.reduce((m, c) => Math.max(m, (c.Position?.Y ?? 0) + (isGroupCard(allCards, c) ? computeGroupFrameLayout(allCards, c.ID).size.height : NOTE_HEIGHT)), 0)
  const yBase = positioned.length > 0 ? maxY + 48 : 24
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
    if (x !== (card?.Position?.X ?? 0) || y !== (card?.Position?.Y ?? 0)) moves.push({ id: box.id, x, y })
  }
  return moves
}

// Positions-sovereign layout + the one-shot Auto-arrange action
// (goal 0089, split from AtlasBoard.tsx at the 500-line seam): every
// level renders Free; position-less cards get packer seats
// (persisted by the same effect that persists overlap nudges);
// an arrangeRequest bump re-packs the whole level and persists it.
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

  const freeMoves = useMemo(
    () => computeFreeMoves(cards, allCards, arrangeAdjacency, boardWidth),
    [cards, allCards, arrangeAdjacency, boardWidth],
  )

  useEffect(() => {
    for (const m of freeMoves) {
      void AtlasService.SetPosition(m.id, { X: m.x, Y: m.y }).catch(console.error)
    }
  }, [freeMoves])

  // The Auto-arrange BUTTON (goal 0089): one-shot packer over this
  // level, persisting every seat -- then control returns to the user.
  const lastArrangeRef = useRef(0)
  useEffect(() => {
    if (!arrangeRequest || arrangeRequest === lastArrangeRef.current) return
    lastArrangeRef.current = arrangeRequest
    const layout = computeAutoArrangeLayout(cards, allCards, arrangeAdjacency, boardWidth > 0 ? boardWidth - 48 : undefined).boxes
    void Promise.all(cards.map((c) => {
      const seat = layout.get(c.ID)
      return seat ? AtlasService.SetPosition(c.ID, { X: seat.x, Y: seat.y }) : Promise.resolve(null)
    })).then(() => refreshAtlas()).catch(console.error)
  }, [arrangeRequest, cards, allCards, arrangeAdjacency, boardWidth])

  return { freeMoves }
}
