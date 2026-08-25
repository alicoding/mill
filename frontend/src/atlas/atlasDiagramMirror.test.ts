import { describe, expect, it } from 'vitest'
import { isDiagramMirrorExtension } from './atlasDiagramMirror'

describe('isDiagramMirrorExtension (goal 0194)', () => {
  it('recognizes .drawio/.mmd/.mermaid regardless of case', () => {
    expect(isDiagramMirrorExtension('/tmp/plan.drawio')).toBe(true)
    expect(isDiagramMirrorExtension('/tmp/PLAN.DRAWIO')).toBe(true)
    expect(isDiagramMirrorExtension('/tmp/flow.mmd')).toBe(true)
    expect(isDiagramMirrorExtension('/tmp/flow.mermaid')).toBe(true)
  })

  it('is false for an unrelated extension', () => {
    expect(isDiagramMirrorExtension('/tmp/notes.md')).toBe(false)
    expect(isDiagramMirrorExtension('/tmp/photo.png')).toBe(false)
    expect(isDiagramMirrorExtension('/tmp/plan.drawio.svg')).toBe(false)
  })
})
