// Per-link-kind tint for quiet edges (goal 0081 slice A4, LOCKED
// design §6c): LinkKind carries no Color field of its own
// (internal/domain/atlas/kind.go) -- recognition comes from the same
// stable-hash-of-ID pattern atlasKindColor.ts already established for
// Kind, kept as its OWN small function here rather than imported: card
// kinds and link kinds are deliberately separate color namespaces, so
// a card's chip and an unrelated link's line landing on the same hash
// bucket would misleadingly suggest a relationship between them.
const LINK_TINT_TOKENS = [
  '--fgColor-accent',
  '--fgColor-success',
  '--fgColor-attention',
  '--fgColor-severe',
  '--fgColor-done',
  '--fgColor-sponsors',
  '--fgColor-neutral',
] as const

export type AtlasLinkTintToken = (typeof LINK_TINT_TOKENS)[number]

// linkKindTintToken returns the same token for the same linkKindID on
// every call (stable across sessions/reloads, no stored state) --
// two different link kinds usually land on two different tokens,
// without this function ever knowing what a LinkKind is CALLED.
export function linkKindTintToken(linkKindID: string): AtlasLinkTintToken {
  let hash = 0
  for (let i = 0; i < linkKindID.length; i++) {
    hash = (hash * 31 + linkKindID.charCodeAt(i)) >>> 0
  }
  return LINK_TINT_TOKENS[hash % LINK_TINT_TOKENS.length]
}
