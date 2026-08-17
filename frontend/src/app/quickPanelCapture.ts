import type { Card, Note, Position } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// The away-capture door's own placement logic (docs/goals/0090),
// split out as pure functions so the cascade math and the Scratchpad
// lookup stay unit-testable without mounting QuickPanel.tsx.

// The seeded Scratchpad card's id (internal/domain/atlas/builtin.go) --
// hardcoded the same way atlasCardPageContent.ts's own
// SEEDED_PERSON_KIND_ID is, since neither the id nor a lookup helper
// is exported from the bindings layer.
export const SEEDED_SCRATCHPAD_CARD_ID = 'atlas-card-scratchpad'

// A captured note always targets the Scratchpad inbox when the seed
// still exists; falls back to root ("") rather than failing when it's
// been deleted, so a capture can never be blocked by a missing card.
export function resolveNoteParentID(cards: Card[] | null | undefined): string {
  const scratchpad = (cards ?? []).find((c) => c.ID === SEEDED_SCRATCHPAD_CARD_ID)
  return scratchpad ? scratchpad.ID : ''
}

const CASCADE_BASE = { X: 80, Y: 80 }
const CASCADE_STEP = 16
// Wraps back to the base offset after this many captures -- an
// unbounded offset would eventually walk new notes off the visible
// board.
const CASCADE_WRAP_AFTER = 10

// Successive captures into the same parent must never land exactly
// stacked: each one steps diagonally from the last by CASCADE_STEP,
// keyed off how many notes already live in that parent.
export function cascadeNotePosition(notes: Note[] | null | undefined, parentID: string): Position {
  const count = (notes ?? []).filter((n) => n.ParentID === parentID).length
  const offset = (count % CASCADE_WRAP_AFTER) * CASCADE_STEP
  return { X: CASCADE_BASE.X + offset, Y: CASCADE_BASE.Y + offset }
}
