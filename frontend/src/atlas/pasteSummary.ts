import type { TFunction } from 'i18next'
import type { PasteResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'

// The paste toast's copy (goal 0138): only the nonzero parts, joined.
export function pasteSummaryText(t: TFunction<'atlas'>, res: PasteResult): string {
  const parts = [
    res.Tables > 0 ? t('paste.tables', { count: res.Tables }) : '',
    res.Cards > 0 ? t('paste.cards', { count: res.Cards }) : '',
    res.Links > 0 ? t('paste.links', { count: res.Links }) : '',
  ].filter(Boolean)
  return t('paste.converted', { what: parts.join(', ') })
}
