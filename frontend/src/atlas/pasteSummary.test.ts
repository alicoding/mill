import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { PasteResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { pasteAsOffer, pasteSummaryText } from './pasteSummary'

const t = ((key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key)) as TFunction<'atlas'>

function result(overrides: Partial<PasteResult> = {}): PasteResult {
  return { Recognized: true, Cards: 0, Links: 0, Tables: 0, Images: 0, PluginObjects: 0, PluginObjectID: '', PluginKind: '', AlternativeKinds: null, SkippedPages: null, ...overrides }
}

describe('pasteSummaryText', () => {
  it('reports only the converted counts when nothing was skipped', () => {
    const text = pasteSummaryText(t, result({ Cards: 2, Links: 1 }))
    expect(text).toBe('paste.converted:{"what":"paste.cards:{\\"count\\":2}, paste.links:{\\"count\\":1}"}')
  })

  // Goal 0179 Slice 0: an image-shaped paste (a local path or URL) has
  // no Cards/Links/Tables at all -- it must still produce a non-empty
  // summary rather than "Pasted as " with nothing after it.
  it('reports an image paste', () => {
    const text = pasteSummaryText(t, result({ Images: 1 }))
    expect(text).toBe('paste.converted:{"what":"paste.images:{\\"count\\":1}"}')
  })

  // Regression (goal 0194): a multi-page source that lost a page must
  // never convert silently -- the skipped page name is always part of
  // the toast, never dropped because the rest of the paste succeeded.
  it('appends which pages were skipped and why, never dropping it silently', () => {
    const text = pasteSummaryText(t, result({ Cards: 4, Links: 2, SkippedPages: ['Broken Page'] }))
    expect(text).toContain('paste.pagesSkipped:{"count":1,"pages":"Broken Page"}')
  })

  it('joins multiple skipped page names into one message', () => {
    const text = pasteSummaryText(t, result({ SkippedPages: ['Page 3', 'Page 7'] }))
    expect(text).toContain('"count":2')
    expect(text).toContain('"pages":"Page 3, Page 7"')
  })
})

describe('pasteAsOffer', () => {
  const labelFor = (kind: string) => (kind === 'bookmark' ? 'Bookmark' : kind === 'clip' ? 'Web clipper' : kind)

  it('offers the first alternative claimant by label, naming what landed', () => {
    const offer = pasteAsOffer(t, result({ PluginObjects: 1, PluginObjectID: 'o1', PluginKind: 'bookmark', AlternativeKinds: ['clip', 'archive'] }), labelFor)
    expect(offer).toEqual({
      text: 'paste.pastedAs:{"kind":"Bookmark"}',
      alternative: { kind: 'clip', label: 'paste.pasteAsInstead:{"kind":"Web clipper"}' },
    })
  })

  // A lone claimant, or a paste no plugin landed, has nothing to offer
  // -- the ordinary summary toast stays.
  it('is null without an alternative or without a landed plugin object', () => {
    expect(pasteAsOffer(t, result({ PluginObjects: 1, PluginObjectID: 'o1', PluginKind: 'bookmark' }), labelFor)).toBeNull()
    expect(pasteAsOffer(t, result({ Cards: 2, AlternativeKinds: ['clip'] }), labelFor)).toBeNull()
  })
})
