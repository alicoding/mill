import type { Card, Note, Link } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { childrenOf } from './atlasGrouping'

// The Atlas board's clone payload (docs/goals/0153): what ⌘C
// serializes to the system clipboard and ⌘V materializes back.
// Readable JSON deliberately (shareable, inspectable). Mirror fields
// (MirrorPath/MirrorChecksum) never enter the payload -- a mirrored
// file has exactly ONE representative card; a second live mirror
// would fight the folder reconcile. sourceID exists so a same-
// instance paste can offer "also copy the items inside" (slice 3);
// on another instance it resolves to nothing and the offer is
// simply absent.
export interface AtlasClonePayload {
  mill: 'clone'
  surface: 'atlas'
  v: 1
  // parentIdx: index of a co-copied parent card, so an explicitly
  // multi-selected frame + children pastes with the children filed
  // inside the cloned frame; null parents to the paste target.
  cards: { sourceID: string; kindID: string; title: string; note: string; fields: Record<string, string>; source: string; viewMode: string; childCount: number; parentIdx: number | null; dx: number; dy: number }[]
  notes: { text: string; dx: number; dy: number }[]
  // Endpoint indexes into cards -- set-scoped by construction (the
  // researched rule: a link comes along only when BOTH ends are in
  // the copied set; nothing dangling, ever).
  links: { source: number; target: number; linkKindID: string; label: string }[]
}

// subtreeSize counts every descendant card and note under a card --
// the "items inside" number the post-paste offer names.
export function subtreeSize(allCards: Card[], allNotes: Note[], cardID: string): number {
  const kids = childrenOf(allCards, cardID)
  const noteKids = allNotes.filter((n) => n.ParentID === cardID)
  return kids.length + noteKids.length + kids.reduce((sum, k) => sum + subtreeSize(allCards, allNotes, k.ID), 0)
}

export function serializeAtlasSelection(
  allCards: Card[], allNotes: Note[], links: Link[],
  selectedCardIDs: string[], selectedNoteIDs: string[],
): AtlasClonePayload | null {
  const cards = selectedCardIDs.map((id) => allCards.find((c) => c.ID === id)).filter((c): c is Card => !!c)
  const notes = selectedNoteIDs.map((id) => allNotes.find((n) => n.ID === id)).filter((n): n is Note => !!n)
  if (cards.length === 0 && notes.length === 0) return null

  const posOf = (p: { X: number; Y: number } | null | undefined) => p ?? { X: 0, Y: 0 }
  const xs = [...cards.map((c) => posOf(c.Position).X), ...notes.map((n) => posOf(n.Position).X)]
  const ys = [...cards.map((c) => posOf(c.Position).Y), ...notes.map((n) => posOf(n.Position).Y)]
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const indexByID = new Map(cards.map((c, i) => [c.ID, i]))
  const selectedSet = new Set(selectedCardIDs)

  return {
    mill: 'clone',
    surface: 'atlas',
    v: 1,
    cards: cards.map((c) => ({
      sourceID: c.ID, kindID: c.KindID, title: c.Title, note: c.Note,
      fields: Object.fromEntries(Object.entries(c.Fields ?? {}).map(([k, v]) => [k, v ?? ''])),
      source: c.Source, viewMode: String(c.ViewMode ?? ''),
      // The full subtree count -- read only for single-card payloads,
      // where the post-paste "also copy the items inside" offer lives
      // (a multi-select paste never offers it; named in the goal file).
      childCount: subtreeSize(allCards, allNotes, c.ID),
      parentIdx: selectedSet.has(c.ParentID) ? (indexByID.get(c.ParentID) ?? null) : null,
      dx: posOf(c.Position).X - minX, dy: posOf(c.Position).Y - minY,
    })),
    notes: notes.map((n) => ({ text: n.Text, dx: posOf(n.Position).X - minX, dy: posOf(n.Position).Y - minY })),
    links: links
      .filter((l) => indexByID.has(l.FromCardID) && indexByID.has(l.ToCardID))
      .map((l) => ({ source: indexByID.get(l.FromCardID)!, target: indexByID.get(l.ToCardID)!, linkKindID: l.LinkKindID, label: l.Label ?? '' })),
  }
}

export function parseAtlasClonePayload(text: string): AtlasClonePayload | null {
  try {
    const parsed = JSON.parse(text) as AtlasClonePayload
    if (parsed && parsed.mill === 'clone' && parsed.surface === 'atlas' && Array.isArray(parsed.cards) && Array.isArray(parsed.notes) && Array.isArray(parsed.links)) return parsed
  } catch {
    // not JSON -- ordinary clipboard content
  }
  return null
}
