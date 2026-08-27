import { describe, expect, it } from 'vitest'
import { angleFromCenter, normalizeAngle, rotatedAABB, snapAngle } from './atlasRotation'

describe('angleFromCenter', () => {
  it('reads 0deg when the pointer sits directly above the center', () => {
    expect(angleFromCenter({ x: 100, y: 100 }, { x: 100, y: 40 })).toBeCloseTo(0)
  })

  it('reads 90deg when the pointer sits directly right of the center', () => {
    expect(angleFromCenter({ x: 100, y: 100 }, { x: 160, y: 100 })).toBeCloseTo(90)
  })

  it('reads -90deg when the pointer sits directly left of the center', () => {
    expect(angleFromCenter({ x: 100, y: 100 }, { x: 40, y: 100 })).toBeCloseTo(-90)
  })

  it('reads 180deg when the pointer sits directly below the center', () => {
    expect(angleFromCenter({ x: 100, y: 100 }, { x: 100, y: 160 })).toBeCloseTo(180)
  })
})

describe('snapAngle', () => {
  it('rounds to the nearest 15deg increment', () => {
    expect(snapAngle(7, 15)).toBe(0)
    expect(snapAngle(8, 15)).toBe(15)
    expect(snapAngle(52, 15)).toBe(45)
    expect(snapAngle(-8, 15)).toBe(-15)
  })
})

describe('normalizeAngle', () => {
  it('folds a negative angle into [0, 360)', () => {
    expect(normalizeAngle(-90)).toBe(270)
    expect(normalizeAngle(-15)).toBe(345)
  })

  it('folds an angle past 360 back into range', () => {
    expect(normalizeAngle(400)).toBe(40)
    expect(normalizeAngle(720)).toBe(0)
  })

  it('leaves an in-range angle unchanged', () => {
    expect(normalizeAngle(45)).toBe(45)
    expect(normalizeAngle(0)).toBe(0)
  })
})

describe('rotatedAABB', () => {
  it('is the identity box at 0deg', () => {
    expect(rotatedAABB(10, 20, 160, 100, 0)).toEqual({ x: 10, y: 20, width: 160, height: 100 })
  })

  it('swaps width/height at 90deg, still centered on the same point', () => {
    const box = rotatedAABB(0, 0, 160, 100, 90)
    expect(box.width).toBeCloseTo(100)
    expect(box.height).toBeCloseTo(160)
    // center stays (80, 50) regardless of rotation
    expect(box.x + box.width / 2).toBeCloseTo(80)
    expect(box.y + box.height / 2).toBeCloseTo(50)
  })

  it('grows both dimensions at 45deg past a square rectangle\'s own diagonal', () => {
    const box = rotatedAABB(0, 0, 100, 100, 45)
    expect(box.width).toBeCloseTo(100 * Math.SQRT2)
    expect(box.height).toBeCloseTo(100 * Math.SQRT2)
  })

  it('is symmetric between a rotation and its 180deg-shifted mirror', () => {
    const a = rotatedAABB(5, 5, 160, 96, 60)
    const b = rotatedAABB(5, 5, 160, 96, 240)
    expect(a.x).toBeCloseTo(b.x)
    expect(a.y).toBeCloseTo(b.y)
    expect(a.width).toBeCloseTo(b.width)
    expect(a.height).toBeCloseTo(b.height)
  })
})
