import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { carryMeasured } from './atlasNodeMeasured'

const node = (id: string, extra: Partial<Node> = {}): Node => ({ id, position: { x: 0, y: 0 }, data: {}, ...extra })
const measured = { width: 240, height: 90 }

describe('carryMeasured', () => {
  it('keeps the previous measurement on a rebuilt height-less node that is the same thing it was', () => {
    const previous = [node('a', { type: 'atlas-sticky', width: 240, measured }), node('b', { type: 'atlas-sticky', width: 240 })]
    const next = [node('a', { type: 'atlas-sticky', width: 240 }), node('b', { type: 'atlas-sticky', width: 240 }), node('c', { type: 'atlas-sticky', width: 240 })]
    const out = carryMeasured(previous, next)
    expect(out[0].measured).toEqual(measured)
    expect(out[1].measured).toBeUndefined()
    expect(out[2].measured).toBeUndefined()
  })

  it('never carries onto a node that changed type, parent or declared dimensions, nor onto one declaring both', () => {
    const previous = [
      node('t', { type: 'atlas-card', measured }),
      node('p', { type: 'atlas-sticky', width: 240, parentId: 'frame-1', measured }),
      node('w', { type: 'atlas-sticky', width: 240, measured }),
      node('d', { type: 'atlas-image', width: 300, height: 200, measured }),
    ]
    const next = [
      node('t', { type: 'atlas-group-tile' }),
      node('p', { type: 'atlas-sticky', width: 240, parentId: 'frame-2' }),
      node('w', { type: 'atlas-sticky', width: 320 }),
      node('d', { type: 'atlas-image', width: 300, height: 200 }),
    ]
    for (const n of carryMeasured(previous, next)) expect(n.measured).toBeUndefined()
  })

  it('never overrides a measurement the new node already carries, and returns the same object when nothing applies', () => {
    const fresh = node('a', { type: 'atlas-sticky', width: 240, measured: { width: 300, height: 120 } })
    const untouched = node('z', { type: 'atlas-sticky', width: 240 })
    const out = carryMeasured([node('a', { type: 'atlas-sticky', width: 240, measured })], [fresh, untouched])
    expect(out[0]).toBe(fresh)
    expect(out[1]).toBe(untouched)
  })
})
