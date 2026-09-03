import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { carryMeasured } from './atlasNodeMeasured'

const node = (id: string, extra: Partial<Node> = {}): Node => ({ id, position: { x: 0, y: 0 }, data: {}, ...extra })

describe('carryMeasured', () => {
  it('keeps the previous measurement on a rebuilt node that declares none', () => {
    const previous = [node('a', { measured: { width: 240, height: 90 } }), node('b')]
    const next = [node('a'), node('b'), node('c')]
    const out = carryMeasured(previous, next)
    expect(out[0].measured).toEqual({ width: 240, height: 90 })
    expect(out[1].measured).toBeUndefined()
    expect(out[2].measured).toBeUndefined()
  })

  it('never overrides a measurement the new node already carries, and returns the same object when nothing changes', () => {
    const previous = [node('a', { measured: { width: 1, height: 1 } })]
    const fresh = node('a', { measured: { width: 300, height: 120 } })
    const untouched = node('z')
    const out = carryMeasured(previous, [fresh, untouched])
    expect(out[0]).toBe(fresh)
    expect(out[1]).toBe(untouched)
  })
})
