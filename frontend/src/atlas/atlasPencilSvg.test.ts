import { describe, expect, it } from 'vitest'
import { buildPencilStrokeSvg, livePreviewPathData, outlinePathData, svgToBase64 } from './atlasPencilSvg'

// A real diagonal drag: perfect-freehand needs several points along a
// path (not just two endpoints) to produce a non-degenerate outline.
const DIAGONAL_STROKE = Array.from({ length: 10 }, (_, i) => ({ x: i * 5, y: i * 5 }))

describe('buildPencilStrokeSvg', () => {
  it('bakes the drawn colour into the SVG fill -- the styleDefaults dual model\'s "on the object" half', () => {
    const doc = buildPencilStrokeSvg(DIAGONAL_STROKE, '#da3633', 4)
    expect(doc).not.toBeNull()
    expect(doc?.svg).toContain('fill="#da3633"')
  })

  it('produces a self-contained viewBox that grows with a larger stroke size', () => {
    const thin = buildPencilStrokeSvg(DIAGONAL_STROKE, '#1f6feb', 2)
    const thick = buildPencilStrokeSvg(DIAGONAL_STROKE, '#1f6feb', 20)
    expect(thin).not.toBeNull()
    expect(thick).not.toBeNull()
    const thinWidth = Number(/width="(\d+(?:\.\d+)?)"/.exec(thin!.svg)?.[1])
    const thickWidth = Number(/width="(\d+(?:\.\d+)?)"/.exec(thick!.svg)?.[1])
    expect(thickWidth).toBeGreaterThan(thinWidth)
  })

  it('reports the stroke\'s own bounding-box origin near the drawn path\'s own start (offset only by the stroke\'s own half-width)', () => {
    const doc = buildPencilStrokeSvg(DIAGONAL_STROKE, '#1f6feb', 4)
    expect(doc?.originX).toBeGreaterThan(-4)
    expect(doc?.originX).toBeLessThan(2)
    expect(doc?.originY).toBeGreaterThan(-4)
    expect(doc?.originY).toBeLessThan(2)
  })

  it('returns null for a stray click (fewer than two points)', () => {
    expect(buildPencilStrokeSvg([{ x: 5, y: 5 }], '#1f6feb', 4)).toBeNull()
    expect(buildPencilStrokeSvg([], '#1f6feb', 4)).toBeNull()
  })
})

describe('outlinePathData', () => {
  it('returns an empty string for an empty outline', () => {
    expect(outlinePathData([])).toBe('')
  })

  it('starts with M and closes with Z', () => {
    const d = outlinePathData([[0, 0], [10, 0], [10, 10], [0, 10]])
    expect(d.startsWith('M 0 0 Q')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
  })
})

describe('livePreviewPathData', () => {
  it('mirrors the final artifact\'s own path data for the same points/size', () => {
    const preview = livePreviewPathData(DIAGONAL_STROKE, 4)
    expect(preview.length).toBeGreaterThan(0)
    expect(preview.startsWith('M')).toBe(true)
  })

  it('returns an empty string before a real stroke exists', () => {
    expect(livePreviewPathData([{ x: 0, y: 0 }], 4)).toBe('')
  })
})

describe('svgToBase64', () => {
  it('round-trips a UTF-8 string through base64', () => {
    const svg = '<svg><path d="M0 0"/></svg>'
    const decoded = atob(svgToBase64(svg))
    expect(decoded).toBe(svg)
  })
})
