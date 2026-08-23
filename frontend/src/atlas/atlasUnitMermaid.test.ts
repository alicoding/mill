import { describe, expect, it } from 'vitest'
import { MERMAID_UNITS } from './atlasUnitMermaid'

describe('MERMAID_UNITS (ADR-0043 board-unit registry, goal 0133 slice 2)', () => {
  const unit = MERMAID_UNITS[0]

  it('detects a .mmd MirrorPath', () => {
    expect(unit.detect({ Source: '', MirrorPath: '/diagrams/flow.mmd' })).toBe(true)
  })

  it('detects a .mermaid MirrorPath, case-insensitively', () => {
    expect(unit.detect({ Source: '', MirrorPath: '/diagrams/FLOW.MERMAID' })).toBe(true)
  })

  it('does not detect an unrelated extension', () => {
    expect(unit.detect({ Source: '', MirrorPath: '/notes/plan.md' })).toBe(false)
  })

  it('tags MMD', () => {
    expect(unit.tag({ Source: '', MirrorPath: '/diagrams/flow.mmd' })).toEqual({ label: 'MMD', color: 'attention' })
  })

  it('declares a Page renderer and a source exporter', () => {
    expect(unit.render.Page).toBeDefined()
    expect(unit.exporters.map((e) => e.format)).toEqual(['mmd'])
  })
})
