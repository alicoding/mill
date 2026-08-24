import { describe, expect, it } from 'vitest'
import { arrowGeometry, boxDimensions, shapePayload, shapeTitle } from './atlasShapeSvg'

describe('boxDimensions', () => {
  it('takes the absolute extent on each axis', () => {
    expect(boxDimensions(-40, 60)).toEqual({ w: 40, h: 60 })
  })

  it('floors at 8 so a near-zero drag still leaves a visible box', () => {
    expect(boxDimensions(0, 0)).toEqual({ w: 8, h: 8 })
  })
})

describe('arrowGeometry', () => {
  it('places the line from (0,0) to (dx,dy) unshifted when the arrow points down-right', () => {
    const g = arrowGeometry(40, 60, 2)
    expect(g).toEqual({ w: 40, h: 60, x1: 0, y1: 0, x2: 40, y2: 60 })
  })

  it('flips the start corner to preserve direction when the arrow points up-left', () => {
    const g = arrowGeometry(-40, -60, 2)
    expect(g).toEqual({ w: 40, h: 60, x1: 40, y1: 60, x2: 0, y2: 0 })
  })

  it('floors each axis at 4x strokeWidth (min 8) for a near-axis-aligned arrow', () => {
    const g = arrowGeometry(100, 0, 1)
    expect(g.h).toBe(8)
    expect(g.w).toBe(100)
  })
})

describe('shapePayload', () => {
  it('stringifies every value, including strokeWidth', () => {
    expect(shapePayload('rectangle', { fill: 'transparent', stroke: '#1f6feb', strokeWidth: 4 }, 'Rectangle')).toEqual({
      shapeType: 'rectangle', fill: 'transparent', stroke: '#1f6feb', strokeWidth: '4', title: 'Rectangle',
    })
  })

  it('carries dx/dy only when extra geometry is supplied', () => {
    const payload = shapePayload('arrow', { fill: 'transparent', stroke: '#1f6feb', strokeWidth: 2 }, 'Arrow', { dx: -10, dy: 5 })
    expect(payload.dx).toBe('-10')
    expect(payload.dy).toBe('5')
  })
})

describe('shapeTitle', () => {
  it('names each of the three shape types', () => {
    expect(shapeTitle('rectangle')).toBe('Rectangle')
    expect(shapeTitle('ellipse')).toBe('Ellipse')
    expect(shapeTitle('arrow')).toBe('Arrow')
  })
})
