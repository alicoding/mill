import { cachedLoader, extensionOf } from './unitRegistry'
import { AtlasService } from '../shared/bindings'
import { base64ToBlob } from '../shared/base64Blob'
import type { UnitExporter, UnitRenderer } from './unitRegistry'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// The drawio units (ADR-0043, goal 0133 slice 3): two registry entries
// sharing one file tag family, resolving different content the same
// way the mermaid/mirror units already do.
//
// - "drawio-svg" matches the FULL ".drawio.svg" suffix, not just
//   ".svg" -- a .drawio.svg is a valid SVG with its diagram XML
//   embedded (drawio's own export format), so it renders through the
//   EXISTING image-mirror Page unmodified: no viewer chunk ever loads
//   for it (the zero-JS fast path). It must be assembled ahead of
//   mirror-image in atlasUnits.ts, or the wider ".svg" match would
//   claim these cards first.
// - "drawio" matches the bare ".drawio" extension and renders through
//   the vendored viewer chunk (AtlasUnitDrawioPage).
const DRAWIO_SVG_SUFFIX = '.drawio.svg'
const DRAWIO_EXTENSION = '.drawio'

function baseName(path: string): string {
  return path.split(/[/\\]/).pop() || 'diagram'
}

// The declared exporter for both units (ADR-0043 §3: "the .drawio file
// itself, at minimum" -- two-way export is a later slice): hands back
// the mirrored file's own bytes unchanged. Image-kind content arrives
// base64-encoded and needs decoding into real bytes; text-kind content
// (the bare .drawio XML) is already a usable BlobPart as-is.
async function serializeOriginalMirror(card: Card, imageMimeType?: string): Promise<{ bytes: BlobPart; filename: string }> {
  const content = await AtlasService.MirrorContent(card.ID)
  const filename = baseName(card.MirrorPath)
  const bytes = imageMimeType ? base64ToBlob(content.Content, imageMimeType) : content.Content
  return { bytes, filename }
}

const DRAWIO_SVG_EXPORTERS: UnitExporter[] = [
  { format: 'drawio.svg', label: 'Diagram (.drawio.svg)', serialize: (card) => serializeOriginalMirror(card, 'image/svg+xml') },
]

const DRAWIO_EXPORTERS: UnitExporter[] = [
  { format: 'drawio', label: 'draw.io diagram (.drawio)', serialize: (card) => serializeOriginalMirror(card) },
]

const drawioSvgPageLoader = cachedLoader(() => import('./AtlasUnitMirrorPage').then((m) => m.AtlasUnitMirrorPage))
const drawioPageLoader = cachedLoader(() => import('./AtlasUnitDrawioPage').then((m) => m.AtlasUnitDrawioPage))

export const DRAWIO_UNITS: UnitRenderer[] = [
  {
    id: 'drawio-svg',
    detect: (card) => card.MirrorPath.toLowerCase().endsWith(DRAWIO_SVG_SUFFIX),
    tag: () => ({ label: 'DRAWIO', color: 'attention' }),
    render: { Page: drawioSvgPageLoader },
    exporters: DRAWIO_SVG_EXPORTERS,
  },
  {
    id: 'drawio',
    detect: (card) => extensionOf(card.MirrorPath) === DRAWIO_EXTENSION,
    tag: () => ({ label: 'DRAWIO', color: 'attention' }),
    render: { Page: drawioPageLoader },
    exporters: DRAWIO_EXPORTERS,
  },
]
