import { describe, expect, it } from 'vitest'
import { isDiagramPath } from './useAtlasDiagramObjectCreate'

describe('isDiagramPath (goal 0179 S2)', () => {
  it('recognizes .drawio/.mmd/.mermaid regardless of case', () => {
    expect(isDiagramPath('/tmp/plan.drawio')).toBe(true)
    expect(isDiagramPath('/tmp/PLAN.DRAWIO')).toBe(true)
    expect(isDiagramPath('/tmp/flow.mmd')).toBe(true)
    expect(isDiagramPath('/tmp/flow.mermaid')).toBe(true)
  })

  // Regression: a .drawio.svg is a real SVG with its diagram embedded
  // -- it renders through the plain image door already, and must never
  // be re-routed into a "diagram" board object.
  it('excludes .drawio.svg -- that variant stays on the image door', () => {
    expect(isDiagramPath('/tmp/plan.drawio.svg')).toBe(false)
  })

  it('is false for an unrelated extension', () => {
    expect(isDiagramPath('/tmp/notes.md')).toBe(false)
    expect(isDiagramPath('/tmp/photo.png')).toBe(false)
  })
})
