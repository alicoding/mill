import { cachedLoader } from './unitRegistry'
import { AtlasService } from '../shared/bindings'
import { base64ToBlob } from '../shared/base64Blob'
import type { UnitExporter, UnitRenderer } from './unitRegistry'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

// The declared table-projection exporters (ADR-0043 §3, goal 0133
// slice E2): entity-backed data (a List's Columns/Rows) serializes in
// Go, not here (ADR-0043 §4) -- each of these calls the ONE Go method
// (AtlasService.TableProjectionExport) that resolves the card's
// projected List and returns ready-to-download base64 bytes plus a
// filename derived from the List's own Label, exactly the
// MirrorContent/base64ToBlob shape the file-backed units already use.
// tsv is deliberately the SAME Go writer as csv with only its
// delimiter differing -- never a second implementation.
function serializeTableFormat(format: string) {
  return async (card: Card): Promise<{ bytes: BlobPart; filename: string }> => {
    const result = await AtlasService.TableProjectionExport(card.ID, format)
    const bytes = format === 'xlsx'
      ? base64ToBlob(result.Data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      : base64ToBlob(result.Data, 'text/plain')
    return { bytes, filename: result.Filename }
  }
}

const TABLE_PROJECTION_EXPORTERS: UnitExporter[] = [
  { format: 'csv', label: 'CSV', serialize: serializeTableFormat('csv') },
  { format: 'tsv', label: 'TSV', serialize: serializeTableFormat('tsv') },
  { format: 'markdown', label: 'Markdown table', serialize: serializeTableFormat('markdown') },
  { format: 'xlsx', label: 'Excel', serialize: serializeTableFormat('xlsx') },
]

// The List -> table projection unit (goal 0105): highest resolution
// priority (ADR-0043 §1 -- "a projection ref beats an extension"),
// detected by ProjectionListID alone, independent of any MirrorPath.
// Carries no file-tag chip -- the board face shows its own
// density-toggle chip instead (AtlasTableCardNode.tsx, untouched).
export const TABLE_PROJECTION_UNITS: UnitRenderer[] = [
  {
    id: 'table-projection',
    detect: (card) => Boolean(card.ProjectionListID),
    tag: () => null,
    render: {
      Page: cachedLoader(() => import('./AtlasUnitTableProjectionPage').then((m) => m.AtlasUnitTableProjectionPage)),
      Face: cachedLoader(() => import('./AtlasUnitTableProjectionFace').then((m) => m.AtlasUnitTableProjectionFace)),
    },
    exporters: TABLE_PROJECTION_EXPORTERS,
  },
]
