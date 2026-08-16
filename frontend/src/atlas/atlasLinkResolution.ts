import type { Card, Link } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

export interface ResolvedBoardEdge {
  id: string
  source: string
  target: string
  // Every LinkKindID aggregated onto this artery, in input order --
  // one entry means the line carries that kind's own label; more mean
  // it labels as a count.
  linkKindIDs: string[]
  count: number
}

// Semantic zoom for LINES (goal 0073): at any board, an edge endpoint
// resolves to the TOP-LEVEL card holding it -- the direct child of
// the focused board -- never to a preview node inside a frame, so a
// line never threads through a frame's own contents. Consequences,
// each deliberate:
// - A link between cards in two different areas draws as ONE
//   area-to-area artery (aggregated with a count), attached at the
//   frame boundaries.
// - A link fully inside one area draws NOTHING at this level -- it's
//   that area's internal detail, visible as a real line once you zoom
//   in (the cards' own link-count chips still carry the truth from
//   outside).
// - Aggregation is undirected: an artery states "these places are
//   related N ways," not a direction; per-link direction lives on the
//   card page.
// A recorded fallback if straight arteries still cross top-level
// items in real use: an obstacle-avoiding connector router
// (libavoid's family). Not adopted while boards carry only a handful
// of aggregate lines.
export function resolveBoardEdges(links: Link[], topLevelIDs: Set<string>, allCards: Card[]): ResolvedBoardEdge[] {
  const parentByID = new Map(allCards.map((c) => [c.ID, c.ParentID]))

  const resolve = (cardID: string): string | null => {
    let cur: string | undefined = cardID
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      if (topLevelIDs.has(cur)) return cur
      seen.add(cur)
      cur = parentByID.get(cur)
    }
    return null
  }

  const byPair = new Map<string, ResolvedBoardEdge>()
  for (const l of links) {
    const a = resolve(l.FromCardID)
    const b = resolve(l.ToCardID)
    if (!a || !b || a === b) continue
    const [source, target] = a < b ? [a, b] : [b, a]
    const key = `${source}|${target}`
    const existing = byPair.get(key)
    if (existing) {
      existing.count += 1
      if (!existing.linkKindIDs.includes(l.LinkKindID)) existing.linkKindIDs.push(l.LinkKindID)
    } else {
      byPair.set(key, { id: l.ID, source, target, linkKindIDs: [l.LinkKindID], count: 1 })
    }
  }
  return [...byPair.values()]
}
