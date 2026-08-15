// Every Kind is user-declared data (ADR-0038 Decision 2) -- there is no
// fixed Kind-name-to-color table the way shared/entityIcons.ts keys off
// a small, known set of built-in entity types. Recognition still needs
// to be ambient (frontend.md's "a card must show its kind ambiently,
// never two kinds in one undifferentiated layout"), so the color comes
// from a stable hash of the Kind's own ID instead of its name -- the
// same card always renders the same color across sessions, and two
// different Kinds usually land on two different colors, without this
// package ever knowing what a Kind is CALLED.
const LABEL_COLORS = [
  'accent',
  'success',
  'attention',
  'severe',
  'done',
  'sponsors',
  'secondary',
] as const

export type AtlasKindColor = (typeof LABEL_COLORS)[number]

export function kindLabelColor(kindID: string): AtlasKindColor {
  let hash = 0
  for (let i = 0; i < kindID.length; i++) {
    hash = (hash * 31 + kindID.charCodeAt(i)) >>> 0
  }
  return LABEL_COLORS[hash % LABEL_COLORS.length]
}
