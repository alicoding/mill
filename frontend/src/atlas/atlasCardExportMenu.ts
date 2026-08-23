import type { TFunction } from 'i18next'
import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { downloadBlob } from '../shared/downloadBlob'
import { exportersForCard } from './atlasUnits'
import type { ExportableCard, UnitExporter } from './unitRegistry'

export interface ExportMenuChoice {
  id: string
  label: string
  run: () => void
}

// buildExportMenuChoice is the ONE place that decides what a card's
// Export-as menu item looks like (ADR-0043 §3 Decision 3, goal 0133
// slice E1: "one command, three surfaces, never two implementations")
// -- the card page action row and the card context menu both call this
// with the same card and render whatever it returns, rather than each
// re-deriving the shape. Absent (null) when the card has nothing
// exportable (no MirrorPath, no declared exporters); a single "Export
// as <Label>" item that downloads directly when exactly one format
// applies; an "Export as..." item that hands its caller the full list
// (to open as a submenu) when more than one does.
export function buildExportMenuChoice({
  card, t, onDownload, onOpenFormats,
}: {
  card: ExportableCard
  t: TFunction<'atlas'>
  onDownload: (exporter: UnitExporter) => void
  onOpenFormats: (exporters: UnitExporter[]) => void
}): ExportMenuChoice | null {
  const items = exportersForCard(card, t('export.originalFile'))
  if (items.length === 0) return null
  if (items.length === 1) {
    return { id: 'export-as', label: t('export.singleLabel', { label: items[0].label }), run: () => onDownload(items[0]) }
  }
  return { id: 'export-as', label: t('export.menuLabel'), run: () => onOpenFormats(items) }
}

// runCardExport serializes one exporter's bytes and hands them to the
// browser's own download mechanism, reporting a failure (a vanished
// source file, a serializer error) through the caller's copyable-
// diagnosis error surface rather than a silent no-op.
export async function runCardExport(card: Card, exporter: UnitExporter, onError: (message: string) => void): Promise<void> {
  try {
    const { bytes, filename } = await exporter.serialize(card)
    downloadBlob(filename, bytes instanceof Blob ? bytes : new Blob([bytes]))
  } catch (err) {
    onError(String(err))
  }
}
