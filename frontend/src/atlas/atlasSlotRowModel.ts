import type { Card, Link, LinkKind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

export interface AtlasSlotChip {
  linkID: string
  cardID: string
  title: string
  // Direction relative to the card THIS slot block belongs to --
  // 'out' = this card is the link's FromCardID, 'in' = ToCardID. The
  // chip is the record in either direction (LOCKED design §3): a card
  // linked TO this one shows up on its row exactly like one linked
  // FROM it, prefixed to say which way.
  direction: 'out' | 'in'
}

export interface AtlasSlotRow {
  linkKindID: string
  label: string
  chips: AtlasSlotChip[]
}

// buildSlotRows is the card page's own slot-row model (goal 0081
// slice A4, LOCKED design §3): one row per declared link kind, chips
// resolved in EITHER direction, ordered links-first so a card with
// real relations never buries them under empty rows. Ties (same
// has-links status) keep linkKinds' own given order -- since a link
// kind is never reordered and a new one is always appended after the
// existing ones, the generic built-in relation kind (created first, for
// every seeded/fresh install) naturally sorts ahead of any later
// custom kind sharing the same has-links status, with no need for
// this pure function to know which kind IS the generic one (ADR-0038
// Decision 2: no card-kind/link-kind identity hardcoded outside a
// seed file).
export function buildSlotRows(card: Card, allCards: Card[], links: Link[], linkKinds: LinkKind[]): AtlasSlotRow[] {
  const cardByID = new Map(allCards.map((c) => [c.ID, c]))
  const rows = linkKinds.map((lk) => ({
    linkKindID: lk.ID,
    label: lk.Label,
    chips: chipsForKind(card, links, lk.ID, cardByID),
  }))
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const aHas = a.row.chips.length > 0
      const bHas = b.row.chips.length > 0
      if (aHas !== bHas) return aHas ? -1 : 1
      return a.index - b.index
    })
    .map(({ row }) => row)
}

function chipsForKind(card: Card, links: Link[], linkKindID: string, cardByID: Map<string, Card>): AtlasSlotChip[] {
  const chips: AtlasSlotChip[] = []
  for (const l of links) {
    if (l.LinkKindID !== linkKindID) continue
    if (l.FromCardID === card.ID) {
      const other = cardByID.get(l.ToCardID)
      if (other) chips.push({ linkID: l.ID, cardID: other.ID, title: other.Title, direction: 'out' })
    } else if (l.ToCardID === card.ID) {
      const other = cardByID.get(l.FromCardID)
      if (other) chips.push({ linkID: l.ID, cardID: other.ID, title: other.Title, direction: 'in' })
    }
  }
  return chips
}
