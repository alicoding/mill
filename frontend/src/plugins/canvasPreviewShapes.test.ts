import { describe, expect, it } from 'vitest'
import { previewShapes } from './canvasPreviewShapes'

// What the host draws for a framed tool (docs/goals/0380 Decision 1).
// The preview is DATA, so the whole vocabulary is checkable here
// without a board: a declaration plus a draft's own record in, the
// primitives out. A malformed value draws nothing rather than half a
// shape, since a plugin's typo must never leave paint on the canvas.

describe('preview shapes', () => {
  it('reads a single primitive’s geometry and paint from the keys the declaration names', () => {
    expect(previewShapes({ kind: 'rect', from: 'box', stroke: 'ink', strokeWidth: 'w' }, { box: '1,2,30,40', ink: '#f00', w: '2' }))
      .toEqual([{ kind: 'rect', geometry: '1,2,30,40', fill: undefined, stroke: '#f00', strokeWidth: '2', opacity: undefined }])
  })

  it('draws nothing when the named key is absent, rather than an empty shape at the origin', () => {
    expect(previewShapes({ kind: 'path', from: 'trail' }, {})).toEqual([])
    expect(previewShapes({ kind: 'path', from: 'trail' }, { trail: '' })).toEqual([])
  })

  it('reads a shape LIST from one key, for a trail whose parts each fade on their own', () => {
    const live = JSON.stringify([
      { kind: 'ellipse', geometry: '0,0,12,12', fill: '#ff3b30', opacity: '1' },
      { kind: 'ellipse', geometry: '4,4,8,8', fill: '#ff3b30', opacity: '0.4' },
    ])
    expect(previewShapes({ kind: 'shapes', from: 'live' }, { live })).toHaveLength(2)
    expect(previewShapes({ kind: 'shapes', from: 'live' }, { live })[1].opacity).toBe('0.4')
  })

  it('drops a list entry that is not a primitive, and the whole list when it is not JSON', () => {
    const mixed = JSON.stringify([{ kind: 'rect', geometry: '0,0,1,1' }, { kind: 'iframe', geometry: 'x' }, { kind: 'rect' }, 'nope'])
    expect(previewShapes({ kind: 'shapes', from: 'live' }, { live: mixed })).toEqual([{ kind: 'rect', geometry: '0,0,1,1' }])
    expect(previewShapes({ kind: 'shapes', from: 'live' }, { live: 'not json' })).toEqual([])
    expect(previewShapes({ kind: 'shapes', from: 'live' }, { live: '{"kind":"rect"}' })).toEqual([])
  })
})
