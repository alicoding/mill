import { describe, expect, it } from 'vitest'
import { UNIT_REGISTRY, resolveUnit } from './atlasUnits'

describe('resolveUnit (ADR-0043 board-unit registry, goal 0133 slice 1)', () => {
  it('resolves table-projection ahead of any MirrorPath extension (a projection ref beats an extension)', () => {
    const unit = resolveUnit({ Source: '', MirrorPath: '/notes/plan.md', ProjectionListID: 'list-1' })
    expect(unit?.id).toBe('table-projection')
  })

  it('resolves the markdown-mirror unit for a .md MirrorPath', () => {
    const unit = resolveUnit({ Source: '', MirrorPath: '/notes/plan.md' })
    expect(unit?.id).toBe('mirror-markdown')
  })

  it('resolves the image unit for a recognized image extension', () => {
    const unit = resolveUnit({ Source: '', MirrorPath: '/assets/logo.png' })
    expect(unit?.id).toBe('mirror-image')
  })

  it('resolves the text unit for a recognized text extension, not the icon fallback (no regression: text mirrors already render real content)', () => {
    const unit = resolveUnit({ Source: '', MirrorPath: '/data/table.csv' })
    expect(unit?.id).toBe('mirror-text')
    expect(unit?.render.Page).toBeDefined()
  })

  it('resolves the mermaid unit for a .mmd MirrorPath, not the text unit or the icon fallback', () => {
    const unit = resolveUnit({ Source: '', MirrorPath: '/diagrams/flow.mmd' })
    expect(unit?.id).toBe('mermaid')
    expect(unit?.render.Page).toBeDefined()
  })

  it('resolves the icon-card fallback for a genuinely unsupported MirrorPath extension', () => {
    const unit = resolveUnit({ Source: '', MirrorPath: '/reports/summary.docx' })
    expect(unit?.id).toBe('icon-fallback')
  })

  it('resolves the icon-card fallback for a .pdf MirrorPath, tagged PDF', () => {
    const unit = resolveUnit({ Source: '', MirrorPath: '/docs/charter.pdf' })
    expect(unit?.id).toBe('icon-fallback')
    expect(unit?.tag({ Source: '', MirrorPath: '/docs/charter.pdf' })).toEqual({ label: 'PDF', color: 'danger' })
  })

  it('resolves the icon-card fallback for a bare Source, tagged URL', () => {
    const unit = resolveUnit({ Source: 'https://example.com', MirrorPath: '' })
    expect(unit?.id).toBe('icon-fallback')
    expect(unit?.tag({ Source: 'https://example.com', MirrorPath: '' })).toEqual({ label: 'URL', color: 'attention' })
  })

  it('resolves to null for a plain card with no MirrorPath, Source, or ProjectionListID -- never a dead-drop fallback for a card with no typed content at all', () => {
    expect(resolveUnit({ Source: '', MirrorPath: '' })).toBeNull()
  })

  it('every registered unit declares a Page renderer', () => {
    for (const unit of UNIT_REGISTRY) {
      expect(unit.render.Page, `${unit.id} should declare a Page renderer`).toBeDefined()
    }
  })
})
