import type { Card, Link } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

export interface ResolvedBoardEdge {
  id: string
  source: string
  target: string
  linkKindID: string
}

// Where a link's line attaches on the current board (goal 0073): the
// endpoint card itself when it's rendered, otherwise the deepest
// VISIBLE ancestor -- the line points at the place holding the thing,
// so no link silently disappears just because its endpoint sits behind
// a frame's "+ K more" cap or deeper than the one-level preview. Edges
// whose endpoints resolve to the same node (both inside one place, or
// one inside the other) are dropped -- a self-loop says nothing at
// this zoom level; the count chips carry it. Multiple links collapsing
// onto the same resolved pair + kind dedupe to one line (they would
// draw pixel-identical anyway); the first link's ID wins, keeping the
// output stable for a stable input order.
export function resolveBoardEdges(links: Link[], renderedIDs: Set<string>, allCards: Card[]): ResolvedBoardEdge[] {
  const parentByID = new Map(allCards.map((c) => [c.ID, c.ParentID]))

  const resolve = (cardID: string): string | null => {
    let cur: string | undefined = cardID
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      if (renderedIDs.has(cur)) return cur
      seen.add(cur)
      cur = parentByID.get(cur)
    }
    return null
  }

  const out: ResolvedBoardEdge[] = []
  const dedupe = new Set<string>()
  for (const l of links) {
    const source = resolve(l.FromCardID)
    const target = resolve(l.ToCardID)
    if (!source || !target || source === target) continue
    const key = `${source}|${target}|${l.LinkKindID}`
    if (dedupe.has(key)) continue
    dedupe.add(key)
    out.push({ id: l.ID, source, target, linkKindID: l.LinkKindID })
  }
  return out
}
