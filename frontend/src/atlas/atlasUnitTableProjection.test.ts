import { describe, expect, it } from 'vitest'
import { TABLE_PROJECTION_UNITS } from './atlasUnitTableProjection'

describe('TABLE_PROJECTION_UNITS (ADR-0043 board-unit registry, goal 0133 slice E2)', () => {
  const unit = TABLE_PROJECTION_UNITS[0]

  it('detects a card by ProjectionListID alone, independent of MirrorPath', () => {
    expect(unit.detect({ Source: '', MirrorPath: '', ProjectionListID: 'list-1' })).toBe(true)
    expect(unit.detect({ Source: '', MirrorPath: '/notes/plan.md', ProjectionListID: '' })).toBe(false)
  })

  it('carries no file-tag chip -- the board face shows its own density chip instead', () => {
    expect(unit.tag({ Source: '', MirrorPath: '', ProjectionListID: 'list-1' })).toBeNull()
  })

  it('declares all four table export formats, in a stable order', () => {
    expect(unit.exporters.map((e) => e.format)).toEqual(['csv', 'tsv', 'markdown', 'xlsx'])
    expect(unit.exporters.map((e) => e.label)).toEqual(['CSV', 'TSV', 'Markdown table', 'Excel'])
  })
})
