import { useEffect, useMemo, useRef } from 'react'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { computeAutoArrangeLayout, computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH } from './atlasBoardLayout'
import { resolveFreeOverlaps } from './atlasOverlapResolution'
import type { resolveBoardEdges } from './atlasLinkResolution'

// Positions-sovereign layout + the one-shot Auto-arrange action
// (goal 0089, split from AtlasBoard.tsx at the 500-line seam): every
// level renders Free; position-less cards get packer seats in memory
// (persisted once by the same effect that persists overlap nudges);
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

  const freeMoves = useMemo(() => {
    // Position-less cards (legacy auto-arrange children, zero-value
    // Position) get packer seats BELOW the positioned cards' extent
    // before overlap resolution -- assistance until the user takes
    // control (goal 0089); the persist effect below then makes the
    // seat durable, so the position-less state exists only once.
    const positioned = cards.filter((c) => (c.Position?.X ?? 0) !== 0 || (c.Position?.Y ?? 0) !== 0)
    const unpositioned = cards.filter((c) => (c.Position?.X ?? 0) === 0 && (c.Position?.Y ?? 0) === 0)
    const packed = unpositioned.length > 0
      ? computeAutoArrangeLayout(unpositioned, allCards, arrangeAdjacency, boardWidth > 0 ? boardWidth - 48 : undefined).boxes
      : new Map<string, { x: number; y: number }>()
    const maxY = positioned.reduce((m, c) => Math.max(m, (c.Position?.Y ?? 0) + (isGroupCard(allCards, c) ? computeGroupFrameLayout(allCards, c.ID).size.height : NOTE_HEIGHT)), 0)
    return resolveFreeOverlaps(cards.map((card) => {
      const frame = isGroupCard(allCards, card)
      const size = frame ? computeGroupFrameLayout(allCards, card.ID).size : { width: NOTE_WIDTH, height: NOTE_HEIGHT }
      const seat = packed.get(card.ID)
      return {
        id: card.ID,
        x: seat ? seat.x : (card.Position?.X ?? 0),
        y: seat ? seat.y + maxY + (positioned.length > 0 ? 48 : 0) : (card.Position?.Y ?? 0),
        width: size.width,
        height: size.height,
        isFrame: frame,
      }
    }))
  }, [cards, allCards, arrangeAdjacency, boardWidth])

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
