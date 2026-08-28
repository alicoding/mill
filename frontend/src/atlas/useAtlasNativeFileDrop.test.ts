import { describe, expect, it } from 'vitest'
import { resolveFileDropKind } from './useAtlasNativeFileDrop'

const alwaysEnabled = () => true
const alwaysDisabled = () => false

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

  it('falls an unrelated extension through to "card"', () => {
    expect(resolveFileDropKind('/tmp/notes.md', alwaysEnabled)).toBe('card')
  })
})
