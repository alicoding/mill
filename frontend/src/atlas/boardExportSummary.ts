import type { TFunction } from 'i18next'
import type { BoardDrawioExport } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'

// The board-as-.drawio export toast's copy (goal 0194's own export
// slice) -- pasteSummary.ts's exact shape run in reverse: only the
// nonzero parts, joined, with anything skipped (ink/image board
// objects, freeform arrows, an unreadable or non-draw.io diagram
// mirror) named rather than silently dropped.
export function boardExportSummaryText(t: TFunction<'atlas'>, res: BoardDrawioExport): string {
  const parts = [
    res.Cards > 0 ? t('boardExport.cards', { count: res.Cards }) : '',
    res.Links > 0 ? t('boardExport.links', { count: res.Links }) : '',
    res.Shapes > 0 ? t('boardExport.shapes', { count: res.Shapes }) : '',
  ].filter(Boolean)
  const summary = t('boardExport.converted', { what: parts.join(', ') })
  if (!res.Skipped || res.Skipped.length === 0) return summary
  const skipped = t('boardExport.skipped', { count: res.Skipped.length, items: res.Skipped.join(', ') })
  return `${summary} ${skipped}`
}
