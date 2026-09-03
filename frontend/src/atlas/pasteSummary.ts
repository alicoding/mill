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

// pasteAsOffer -- the "paste as … instead" chooser's content (ADR-0051
// slice 2, the converged paste-provider model: the first provider's
// edit applies, the others are offered). Non-null only when a plugin
// claim landed the paste AND another enabled plugin claimed the same
// link: the toast then names what landed and offers the top
// alternative (the quiet toast carries one action; a third claimant
// is reachable through the Extensions preference). labelFor turns a
// board-object kind into the user-facing tool label.
export function pasteAsOffer(t: TFunction<'atlas'>, res: PasteResult, labelFor: (kind: string) => string): { text: string; alternative: { kind: string; label: string } } | null {
  const alternative = res.AlternativeKinds?.[0]
  if (!res.PluginObjectID || !res.PluginKind || !alternative) return null
  return {
    text: t('paste.pastedAs', { kind: labelFor(res.PluginKind) }),
    alternative: { kind: alternative, label: t('paste.pasteAsInstead', { kind: labelFor(alternative) }) },
  }
}
