import { describe, expect, it } from 'vitest'
import { angleFromCenter, normalizeAngle, snapAngle } from './atlasRotation'

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
