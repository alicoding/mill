import { cachedLoader, extensionOf } from './unitRegistry'
import { AtlasService } from '../shared/bindings'
import type { UnitExporter, UnitRenderer } from './unitRegistry'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// The standalone mermaid-source unit (ADR-0043, goal 0133 slice 2): a
// card whose MirrorPath IS mermaid diagram source, rendered as a
// diagram rather than as plain text (mirror-text) or an icon
// (icon-fallback). Distinct from mirror-markdown/mirror-text because
// its Page renders the source THROUGH mermaid, not as-is -- but it
// still detects on extension alone, same shape as every other mirror
// unit.
const MERMAID_EXTENSIONS = new Set(['.mmd', '.mermaid'])

const mermaidPageLoader = cachedLoader(() => import('./AtlasUnitMermaidPage').then((m) => m.AtlasUnitMermaidPage))

// The declared exporter (ADR-0043 §3: "the source .mmd itself, at
// minimum"): hands back the mirrored file's own raw source unchanged
// -- the only honest export for a unit whose entire value already IS
// its source file, with no derived format yet to offer.
async function serializeMermaidSource(card: Card): Promise<{ bytes: BlobPart; filename: string }> {
  const content = await AtlasService.MirrorContent(card.ID)
  const base = card.MirrorPath.split(/[/\\]/).pop()
  return { bytes: content.Content, filename: base || 'diagram.mmd' }
}

const MERMAID_EXPORTERS: UnitExporter[] = [
  { format: 'mmd', label: 'Mermaid source (.mmd)', serialize: serializeMermaidSource },
]

export const MERMAID_UNITS: UnitRenderer[] = [
  {
    id: 'mermaid',
    detect: (card) => MERMAID_EXTENSIONS.has(extensionOf(card.MirrorPath)),
    tag: () => ({ label: 'MMD', color: 'attention' }),
    render: { Page: mermaidPageLoader },
    exporters: MERMAID_EXPORTERS,
  },
]
