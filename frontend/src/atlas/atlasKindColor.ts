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

// The board's own glyph square/region-frame border+fill need the
// underlying CSS custom property NAMES behind each kindLabelColor
// bucket (Primer's Label variant already only accepts a variant name,
// never a paintable value) -- "secondary" has no dedicated Primer
// semantic scale of its own, so it maps onto the neutral scale, same
// substitution Primer's own Label component makes internally.
export interface KindColorTokens {
  emphasis: string
  muted: string
  borderMuted: string
  fg: string
}

const TOKENS_BY_COLOR: Record<AtlasKindColor, KindColorTokens> = {
  accent: { emphasis: '--bgColor-accent-emphasis', muted: '--bgColor-accent-muted', borderMuted: '--borderColor-accent-muted', fg: '--fgColor-accent' },
  success: { emphasis: '--bgColor-success-emphasis', muted: '--bgColor-success-muted', borderMuted: '--borderColor-success-muted', fg: '--fgColor-success' },
  attention: { emphasis: '--bgColor-attention-emphasis', muted: '--bgColor-attention-muted', borderMuted: '--borderColor-attention-muted', fg: '--fgColor-attention' },
  severe: { emphasis: '--bgColor-severe-emphasis', muted: '--bgColor-severe-muted', borderMuted: '--borderColor-severe-muted', fg: '--fgColor-severe' },
  done: { emphasis: '--bgColor-done-emphasis', muted: '--bgColor-done-muted', borderMuted: '--borderColor-done-muted', fg: '--fgColor-done' },
  sponsors: { emphasis: '--bgColor-sponsors-emphasis', muted: '--bgColor-sponsors-muted', borderMuted: '--borderColor-sponsors-muted', fg: '--fgColor-sponsors' },
  secondary: { emphasis: '--bgColor-neutral-emphasis', muted: '--bgColor-neutral-muted', borderMuted: '--borderColor-neutral-muted', fg: '--fgColor-neutral' },
}

export function kindColorTokens(kindID: string): KindColorTokens {
  return TOKENS_BY_COLOR[kindLabelColor(kindID)]
}
