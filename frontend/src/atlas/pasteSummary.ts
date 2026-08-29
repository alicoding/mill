import type { TFunction } from 'i18next'
import type { PasteResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'

// The paste toast's copy (goal 0138): only the nonzero parts, joined.
// A multi-page source that lost a page (goal 0194) never converts
// silently -- the skipped page names are appended to the same toast.
export function pasteSummaryText(t: TFunction<'atlas'>, res: PasteResult): string {
  const parts = [
    res.Tables > 0 ? t('paste.tables', { count: res.Tables }) : '',
    res.Cards > 0 ? t('paste.cards', { count: res.Cards }) : '',
    res.Links > 0 ? t('paste.links', { count: res.Links }) : '',
    res.Images > 0 ? t('paste.images', { count: res.Images }) : '',
    res.PluginObjects > 0 ? t('paste.pluginObjects', { count: res.PluginObjects }) : '',
  ].filter(Boolean)
  const summary = t('paste.converted', { what: parts.join(', ') })
  if (!res.SkippedPages || res.SkippedPages.length === 0) return summary
  const skipped = t('paste.pagesSkipped', { count: res.SkippedPages.length, pages: res.SkippedPages.join(', ') })
  return `${summary} ${skipped}`
}
