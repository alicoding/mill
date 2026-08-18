import type { Card, Link, Perspective } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// The board's own client-side mirror of atlas.FilterByPerspective
// (internal/domain/atlas/perspective.go, ADR-0041) -- no bound RPC
// exposes that pure Go function, so the frontend recomputes the exact
// same rule locally: a card renders iff it's a member; a link renders
// iff the link itself AND both its endpoints are members. MemberCardIDs
// is already closed under ancestry by the service's own
// AddToPerspective/authoring-while-active writers, so filtering a flat
// card list by membership alone is enough to keep containment visible --
// no separate ancestor walk needed here.
export function filterCardsByPerspective(cards: Card[], perspective: Perspective | null): Card[] {
  if (!perspective) return cards
  const memberCards = new Set(perspective.MemberCardIDs ?? [])
  return cards.filter((c) => memberCards.has(c.ID))
}

export function filterLinksByPerspective(links: Link[], perspective: Perspective | null): Link[] {
  if (!perspective) return links
  const memberCards = new Set(perspective.MemberCardIDs ?? [])
  const memberLinks = new Set(perspective.MemberLinkIDs ?? [])
  return links.filter((l) => memberLinks.has(l.ID) && memberCards.has(l.FromCardID) && memberCards.has(l.ToCardID))
}
