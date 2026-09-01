import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import type { BoardObject, Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { computeAutoArrangeLayout, computeGroupFrameLayout, isGroupCard, NOTE_HEIGHT, NOTE_WIDTH, OBJECT_FALLBACK_EXTENT, type ArrangeObjectTile } from './atlasBoardLayout'
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
// stacked all position-less cards at the zero value. Board objects
// never seat here (their Position is required on the wire) but their
// extent counts: without it a fresh card seats straight under an
// object (goal 0265). Exported pure for its unit test.
export function computeFreeMoves(
  cards: Card[],
  allCards: Card[],
  arrangeAdjacency: Map<string, string[]>,
  boardWidth: number,
  objects: BoardObject[] = [],
  allNotes: Note[] = [],
  allObjects: BoardObject[] = [],
): { id: string; x: number; y: number }[] {
  const positioned = cards.filter((c) => c.Position != null)
  const unpositioned = cards.filter((c) => c.Position == null)
  const packed = unpositioned.length > 0
    ? computeAutoArrangeLayout(unpositioned, allCards, arrangeAdjacency, boardWidth > 0 ? boardWidth - 48 : undefined, allNotes, [], allObjects).boxes
    : new Map<string, { x: number; y: number }>()
  const cardMaxY = positioned.reduce((m, c) => Math.max(m, (c.Position?.Y ?? 0) + (isGroupCard(allCards, c, allNotes, allObjects) ? computeGroupFrameLayout(allCards, c.ID, allNotes, allObjects).size.height : NOTE_HEIGHT)), 0)
  const maxY = objects.reduce((m, o) => Math.max(m, o.Position.Y + (o.Size?.H ?? OBJECT_FALLBACK_EXTENT)), cardMaxY)
  const yBase = positioned.length > 0 || objects.length > 0 ? maxY + 48 : 0
  const seatedBoxes = cards.map((card) => {
    const frame = isGroupCard(allCards, card, allNotes, allObjects)
    const size = frame ? computeGroupFrameLayout(allCards, card.ID, allNotes, allObjects).size : { width: NOTE_WIDTH, height: NOTE_HEIGHT }
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

// An object's packer footprint: measured rotation-aware AABB when the
// board has rendered it (the same source hit-testing trusts), else the
// persisted Size, else the natural-size clamp ceiling. Exported pure
// for its unit test.
export function objectArrangeTiles(
  objects: BoardObject[],
  measuredBoxes: { id: string; width: number; height: number }[],
): ArrangeObjectTile[] {
  const measured = new Map(measuredBoxes.map((b) => [b.id, b]))
  return objects.map((o) => {
    const m = measured.get(o.ID)
    return {
      id: o.ID,
      width: (m?.width || 0) > 0 ? m!.width : (o.Size?.W ?? OBJECT_FALLBACK_EXTENT),
      height: (m?.height || 0) > 0 ? m!.height : (o.Size?.H ?? OBJECT_FALLBACK_EXTENT),
      createdAt: String(o.CreatedAt ?? ''),
    }
  })
}

// Positions-sovereign layout + the one-shot Auto-arrange action
// (goal 0089, split from AtlasBoard.tsx at the 500-line seam): every
// level renders Free; position-less cards get in-memory packer seats
// (assistance until the user takes control -- nothing persists from
// rendering); an arrangeRequest bump re-packs the level and persists.
// Board objects are full packing peers of cards (goal 0265): the
// arrange button seats and persists them too, superseding the
// boardobject.go comment that once scoped arrange to cards.
export function useAtlasArrange({ cards, allCards, arteries, boardWidth, arrangeRequest, objects, allNotes, allObjects, objectBoxesRef }: {
  cards: Card[]
  allCards: Card[]
  allNotes: Note[]
  allObjects: BoardObject[]
  arteries: ReturnType<typeof resolveBoardEdges>
  boardWidth: number
  arrangeRequest?: number
  objects: BoardObject[]
  // The live measured/rotation-aware object AABBs, as a ref: the boxes
  // derive from React Flow's `nodes` state, which itself derives from
  // this hook's own freeMoves -- a direct dependency would cycle. The
  // arrange effect only reads it at click time, when the board has
  // long been measured.
  objectBoxesRef: RefObject<{ id: string; x: number; y: number; width: number; height: number }[]>
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
    () => computeFreeMoves(cards, allCards, arrangeAdjacency, boardWidth, objects, allNotes, allObjects),
    [cards, allCards, arrangeAdjacency, boardWidth, objects, allNotes, allObjects],
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
    const measuredBoxes = objectBoxesRef.current ?? []
    const tiles = objectArrangeTiles(objects, measuredBoxes)
    const layout = computeAutoArrangeLayout(cards, allCards, arrangeAdjacency, boardWidth - 48, allNotes, tiles, allObjects).boxes
    const measuredByID = new Map(measuredBoxes.map((b) => [b.id, b]))
    void Promise.all([
      ...cards.map((c) => {
        const seat = layout.get(c.ID)
        return seat ? AtlasService.SetPosition(c.ID, { X: seat.x, Y: seat.y }) : Promise.resolve(null)
      }),
      ...objects.map((o) => {
        const seat = layout.get(o.ID)
        if (!seat) return Promise.resolve(null)
        // A rotated object's tile is its AABB; Position stays the
        // unrotated top-left, so the seat translates back by the
        // current Position-to-AABB offset (zero for everything else).
        const m = measuredByID.get(o.ID)
        const dx = m ? o.Position.X - m.x : 0
        const dy = m ? o.Position.Y - m.y : 0
        return AtlasService.SetBoardObjectPosition(o.ID, { X: seat.x + dx, Y: seat.y + dy })
      }),
    ]).then(() => refreshAtlas()).catch(console.error)
  }, [arrangeRequest, cards, allCards, arrangeAdjacency, boardWidth, objects, allNotes, allObjects, objectBoxesRef])

  return { freeMoves }
}
