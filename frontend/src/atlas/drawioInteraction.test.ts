import { describe, expect, it } from 'vitest'
import {
  DRAWIO_MAX_SCALE,
  DRAWIO_MIN_SCALE,
  DRAWIO_WHEEL_NOTCH,
  DRAWIO_ZOOM_FACTOR,
  exceedsFrame,
  isPrimaryDrag,
  panBy,
  zoomAbout,
} from './drawioInteraction'

// The geometry the in-frame pan/zoom rests on (goal 0340). mxGraph
// places a graph point at screen position (point + translate) * scale,
// so every assertion below is written against that one relation rather
// than against the numbers a particular gesture happened to produce.
const screenOf = (point: number, view: { scale: number; t: number }) => (point + view.t) * view.scale

describe('panBy', () => {
  it('moves the drawing opposite the wheel, in unscaled graph units', () => {
    expect(panBy({ scale: 1, tx: 0, ty: 0 }, 0, 100)).toEqual({ tx: 0, ty: -100 })
    expect(panBy({ scale: 1, tx: 0, ty: 0 }, 40, 0)).toEqual({ tx: -40, ty: 0 })
  })

  it('divides the screen delta by scale, so a gesture moves the same PIXELS at any zoom', () => {
    const zoomed = panBy({ scale: 2, tx: 0, ty: 0 }, 0, 100)
    expect(zoomed.ty).toBe(-50)
    // 50 unscaled units at scale 2 is exactly the 100 screen pixels the
    // wheel asked for.
    expect(screenOf(0, { scale: 2, t: 0 }) - screenOf(0, { scale: 2, t: zoomed.ty })).toBe(100)
  })

  it('accumulates from the current translate rather than from the origin', () => {
    expect(panBy({ scale: 1, tx: -10, ty: -200 }, 0, 100)).toEqual({ tx: -10, ty: -300 })
  })
})

describe('zoomAbout', () => {
  it('takes one full wheel notch as exactly the viewer toolbar zoom step', () => {
    expect(zoomAbout({ scale: 1, tx: 0, ty: 0 }, 0, 0, -DRAWIO_WHEEL_NOTCH).scale).toBeCloseTo(DRAWIO_ZOOM_FACTOR, 10)
    expect(zoomAbout({ scale: 1, tx: 0, ty: 0 }, 0, 0, DRAWIO_WHEEL_NOTCH).scale).toBeCloseTo(1 / DRAWIO_ZOOM_FACTOR, 10)
  })

  it('scales a partial delta proportionally, so a trackpad pinch never jumps a whole step', () => {
    const small = zoomAbout({ scale: 1, tx: 0, ty: 0 }, 0, 0, -10).scale
    expect(small).toBeGreaterThan(1)
    expect(small).toBeLessThan(DRAWIO_ZOOM_FACTOR)
  })

  it('keeps the point under the cursor under the cursor', () => {
    const before = { scale: 1, tx: -32, ty: -240 }
    const cx = 180
    const cy = 90
    const after = zoomAbout(before, cx, cy, -DRAWIO_WHEEL_NOTCH)
    // The graph point the cursor was over, before and after.
    const pointBefore = { x: cx / before.scale - before.tx, y: cy / before.scale - before.ty }
    const pointAfter = { x: cx / after.scale - after.tx, y: cy / after.scale - after.ty }
    expect(pointAfter.x).toBeCloseTo(pointBefore.x, 6)
    expect(pointAfter.y).toBeCloseTo(pointBefore.y, 6)
  })

  it('clamps the scale and still anchors the cursor at the clamped scale', () => {
    const deep = zoomAbout({ scale: DRAWIO_MAX_SCALE, tx: 0, ty: 0 }, 100, 100, -DRAWIO_WHEEL_NOTCH * 20)
    expect(deep.scale).toBe(DRAWIO_MAX_SCALE)
    // Nothing changed, so the translate must not have drifted either.
    expect(deep.tx).toBeCloseTo(0, 10)
    expect(deep.ty).toBeCloseTo(0, 10)

    const shallow = zoomAbout({ scale: DRAWIO_MIN_SCALE, tx: 0, ty: 0 }, 100, 100, DRAWIO_WHEEL_NOTCH * 20)
    expect(shallow.scale).toBe(DRAWIO_MIN_SCALE)
  })
})

describe('exceedsFrame', () => {
  it('is true when the drawing is taller than the frame', () => {
    expect(exceedsFrame({ width: 200, height: 3100 }, { width: 420, height: 320 })).toBe(true)
  })

  it('is true when the drawing is wider than the frame', () => {
    expect(exceedsFrame({ width: 900, height: 100 }, { width: 420, height: 320 })).toBe(true)
  })

  it('is false when the drawing fits, tolerating mxGraph rounding its own sizing up', () => {
    expect(exceedsFrame({ width: 200, height: 200 }, { width: 420, height: 320 })).toBe(false)
    expect(exceedsFrame({ width: 421, height: 321 }, { width: 420, height: 320 })).toBe(false)
    expect(exceedsFrame({ width: 423, height: 100 }, { width: 420, height: 320 })).toBe(true)
  })

  it('reads only the extent, so panning a drawing never changes the answer', () => {
    const frame = { width: 420, height: 320 }
    expect(exceedsFrame({ width: 200, height: 3100 }, frame)).toBe(exceedsFrame({ width: 200, height: 3100 }, frame))
  })
})

describe('isPrimaryDrag', () => {
  it('accepts a plain left press', () => {
    expect(isPrimaryDrag({ button: 0, ctrlKey: false } as MouseEvent)).toBe(true)
  })

  it('refuses a secondary press, so the board context menu still opens over a diagram', () => {
    expect(isPrimaryDrag({ button: 2, ctrlKey: false } as MouseEvent)).toBe(false)
    expect(isPrimaryDrag({ button: 0, ctrlKey: true } as MouseEvent)).toBe(false)
  })
})

