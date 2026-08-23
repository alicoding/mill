import { describe, expect, it } from 'vitest'
import { DRAWIO_UNITS } from './atlasUnitDrawio'

describe('DRAWIO_UNITS (ADR-0043 board-unit registry, goal 0133 slice 3)', () => {
  const drawioSvg = DRAWIO_UNITS[0]
  const drawio = DRAWIO_UNITS[1]

  it('drawio-svg detects the full .drawio.svg suffix, case-insensitively', () => {
    expect(drawioSvg.detect({ Source: '', MirrorPath: '/diagrams/flow.drawio.svg' })).toBe(true)
    expect(drawioSvg.detect({ Source: '', MirrorPath: '/diagrams/FLOW.DRAWIO.SVG' })).toBe(true)
  })

  it('drawio-svg does not detect a bare .svg (that stays mirror-image)', () => {
    expect(drawioSvg.detect({ Source: '', MirrorPath: '/assets/logo.svg' })).toBe(false)
  })

  it('drawio-svg renders through the existing mirror-image Page, no viewer chunk', () => {
    expect(drawioSvg.render.Page).toBeDefined()
  })

  it('drawio detects the bare .drawio extension, case-insensitively', () => {
    expect(drawio.detect({ Source: '', MirrorPath: '/diagrams/flow.drawio' })).toBe(true)
    expect(drawio.detect({ Source: '', MirrorPath: '/diagrams/FLOW.DRAWIO' })).toBe(true)
  })

  it('drawio does not detect .drawio.svg (that stays drawio-svg)', () => {
    expect(drawio.detect({ Source: '', MirrorPath: '/diagrams/flow.drawio.svg' })).toBe(false)
  })

  it('both units tag DRAWIO and declare a source-preserving exporter', () => {
    expect(drawioSvg.tag({ Source: '', MirrorPath: '/x.drawio.svg' })).toEqual({ label: 'DRAWIO', color: 'attention' })
    expect(drawio.tag({ Source: '', MirrorPath: '/x.drawio' })).toEqual({ label: 'DRAWIO', color: 'attention' })
    expect(drawioSvg.exporters.map((e) => e.format)).toEqual(['drawio.svg'])
    expect(drawio.exporters.map((e) => e.format)).toEqual(['drawio'])
  })
})
