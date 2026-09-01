import { describe, expect, it } from 'vitest'
import { resolveFileDropKind } from './useAtlasNativeFileDrop'
import type { ThirdPartyNounShape } from './atlasNounRegistry'

const alwaysEnabled = () => true
const alwaysDisabled = () => false

// Only the fields the drop router reads -- claim-lookup tests inject
// this instead of registering into the real third-party registry.
const claimedNoun = { id: 'bookmark', boardObjectKind: 'bookmark', fileExtensions: ['.webloc'] } as unknown as ThirdPartyNounShape
const claimLookup = (ext: string) => (claimedNoun.fileExtensions.includes(ext) ? claimedNoun : undefined)

describe('resolveFileDropKind (goal 0237 S3 rider)', () => {
  it('routes a diagram path to "diagram" when the diagram extension is enabled', () => {
    expect(resolveFileDropKind('/tmp/plan.drawio', alwaysEnabled)).toBe('diagram')
  })

  // Regression: disabling diagram from Settings > Extensions has no
  // tray button to remove (diagram is file-drop only), so it must
  // instead fall the drop through to the generic card path.
  it('falls a disabled diagram drop through to the "card" path', () => {
    expect(resolveFileDropKind('/tmp/plan.drawio', alwaysDisabled)).toBe('card')
    expect(resolveFileDropKind('/tmp/flow.mmd', (id) => id !== 'diagram')).toBe('card')
  })

  it('routes a sheet path to "sheet" when the sheet extension is enabled', () => {
    expect(resolveFileDropKind('/tmp/data.xlsx', alwaysEnabled)).toBe('sheet')
    expect(resolveFileDropKind('/tmp/data.csv', alwaysEnabled)).toBe('sheet')
  })

  // Regression: same fall-through as diagram -- sheet has no tray
  // button either.
  it('falls a disabled sheet drop through to the "card" path', () => {
    expect(resolveFileDropKind('/tmp/data.xlsx', alwaysDisabled)).toBe('card')
    expect(resolveFileDropKind('/tmp/data.csv', (id) => id !== 'sheet')).toBe('card')
  })

  it('routes an image path to "image" regardless of diagram/sheet enablement', () => {
    expect(resolveFileDropKind('/tmp/photo.png', alwaysDisabled)).toBe('image')
  })

  it('routes a .pdf path to "pdf" when enabled, case-insensitively (goal 0267)', () => {
    expect(resolveFileDropKind('/tmp/report.pdf', alwaysEnabled)).toBe('pdf')
    expect(resolveFileDropKind('/tmp/REPORT.PDF', alwaysEnabled)).toBe('pdf')
  })

  // Same fall-through as diagram/sheet -- pdf has no tray button
  // either.
  it('falls a disabled pdf drop through to the "card" path', () => {
    expect(resolveFileDropKind('/tmp/report.pdf', (id) => id !== 'pdf')).toBe('card')
  })

  it('falls an unrelated extension through to "card"', () => {
    expect(resolveFileDropKind('/tmp/notes.md', alwaysEnabled)).toBe('card')
  })

  // Plugin ingestion claims (docs/goals/0251): a manifest-claimed
  // extension routes to the plugin's noun -- behind every built-in
  // shape, ahead of the card fallback.
  it('routes a plugin-claimed extension to the claiming noun', () => {
    expect(resolveFileDropKind('/tmp/site.webloc', alwaysEnabled, claimLookup)).toBe(claimedNoun)
  })

  it('never lets a plugin claim shadow a built-in shape', () => {
    const greedy = () => claimedNoun
    expect(resolveFileDropKind('/tmp/plan.drawio', alwaysEnabled, greedy)).toBe('diagram')
    expect(resolveFileDropKind('/tmp/photo.png', alwaysEnabled, greedy)).toBe('image')
    expect(resolveFileDropKind('/tmp/data.xlsx', alwaysEnabled, greedy)).toBe('sheet')
  })

  it('falls an unclaimed extension through to "card" even with claims registered', () => {
    expect(resolveFileDropKind('/tmp/notes.md', alwaysEnabled, claimLookup)).toBe('card')
  })
})
