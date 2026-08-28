import { cachedLoader, extensionOf } from './unitRegistry'
import type { UnitRenderer } from './unitRegistry'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])

// Kept identical to atlas/mirror.go's imageMimeTypes allow-list (frontend
// tag derivation and the backend's own MirrorKind classification must
// name the same set, or a card's face tag and its actual preview kind
// could disagree). Exported so the image tool's own picked-path input
// (AtlasImageInput.tsx, goal 0169 slice 2) and the native drop routing
// predicate (useAtlasImageObjectCreate.ts, goal 0206) both validate
// against this exact set rather than a third copy.
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.heic'])

// Kept identical to atlas/mirror.go's textExtensions allow-list. Not
// one of ADR-0043's three named migrated units, but required for
// zero-regression absorption: AtlasCardMirrorPreview already renders
// real preformatted content for these (MirrorKindText) today, so
// without this unit they would wrongly fall through to the icon-card
// fallback -- a regression, not a migration. Registered here (same
// Page component, no tag chip -- matching deriveFileTag's pre-registry
// behavior of returning no tag for these extensions) rather than as a
// fourth top-level "unit family" file, since it shares its renderer and
// its reasoning entirely with the mirror units above.
const TEXT_EXTENSIONS = new Set(['.txt', '.log', '.json', '.yaml', '.yml', '.csv', '.tsv', '.xml', '.ini', '.conf', '.toml', '.sh', '.env'])

// One shared Page loader: every unit below renders through the exact
// same lazy chunk (AtlasUnitMirrorPage -> AtlasCardMirrorPreview),
// cached once regardless of which unit resolves first for a given
// board.
const mirrorPageLoader = cachedLoader(() => import('./AtlasUnitMirrorPage').then((m) => m.AtlasUnitMirrorPage))

// The markdown-mirror and image units (ADR-0043 Consequences: "the
// existing three units migrate INTO the registry... markdown mirror,
// table projection, image via the existing IMG tag class"), plus the
// text unit above. Resolution order: an extension match only fires
// when no higher-priority unit (table-projection) already claimed the
// card, per atlasUnits.ts's assembly order.
export const MIRROR_UNITS: UnitRenderer[] = [
  {
    id: 'mirror-markdown',
    detect: (card) => MARKDOWN_EXTENSIONS.has(extensionOf(card.MirrorPath)),
    tag: () => ({ label: 'MD', color: 'success' }),
    render: { Page: mirrorPageLoader },
    exporters: [],
  },
  {
    id: 'mirror-image',
    detect: (card) => IMAGE_EXTENSIONS.has(extensionOf(card.MirrorPath)),
    tag: () => ({ label: 'IMG', color: 'attention' }),
    render: {
      Page: mirrorPageLoader,
      // Closing goal 0179's gap 2: a promoted image card is otherwise
      // an empty titled box until opened (AtlasNoteCardNode.tsx
      // consumes this Face for every unit that declares one).
      Face: cachedLoader(() => import('./AtlasUnitMirrorImageFace').then((m) => m.AtlasUnitMirrorImageFace)),
    },
    exporters: [],
  },
  {
    id: 'mirror-text',
    detect: (card) => TEXT_EXTENSIONS.has(extensionOf(card.MirrorPath)),
    tag: () => null,
    render: { Page: mirrorPageLoader },
    exporters: [],
  },
]
