import { cachedLoader, extensionOf } from './unitRegistry'
import type { UnitRenderer } from './unitRegistry'

// The icon-card fallback (ADR-0043 §2): the floor, not an error. Its
// detect() is deliberately the widest of any unit -- any MirrorPath or
// Source at all -- so it only ever resolves when placed LAST in
// atlasUnits.ts's assembly order and no more specific unit already
// claimed the card. A card with neither (a plain note) never reaches
// this unit, matching the pre-registry behavior where an untyped
// card's Contents column renders nothing extra.
//
// Its tag() reproduces the old deriveFileTag chain's own remaining
// branches exactly (a .pdf MirrorPath, a bare Source) so absorbing
// deriveFileTag into the registry changes no existing tag output.
export const ICON_FALLBACK_UNITS: UnitRenderer[] = [
  {
    id: 'icon-fallback',
    detect: (card) => Boolean(card.MirrorPath || card.Source),
    tag: (card) => {
      if (extensionOf(card.MirrorPath) === '.pdf') return { label: 'PDF', color: 'danger' }
      if (card.Source) return { label: 'URL', color: 'attention' }
      return null
    },
    render: {
      Page: cachedLoader(() => import('./AtlasUnitIconFallbackPage').then((m) => m.AtlasUnitIconFallback)),
    },
    exporters: [],
  },
]
