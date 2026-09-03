import { describe, expect, it } from 'vitest'
import { adaptGesture, adaptStyleFields, buildThirdPartyNoun, canvasToolDeclError, styleFieldDefault } from './canvasToolAdapter'
import { resolveEditRoute } from '../atlas/objectSeams'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { CanvasObjectDecl } from './sdk'

const base: CanvasObjectDecl = {
  kind: 'thing', label: 'Thing', icon: '⭐', source: 'board-local', editRoute: 'none',
  renderFace: () => {},
}

describe('canvasToolDeclError', () => {
  it('accepts the plain click declaration unchanged', () => {
    expect(canvasToolDeclError(base)).toBeNull()
  })

  it('requires a gesture with onEnd for a drag interaction', () => {
    expect(canvasToolDeclError({ ...base, interaction: 'drag-to-draw' })).toMatch(/requires a gesture/)
    expect(canvasToolDeclError({ ...base, interaction: 'drag-to-draw', gesture: { onEnd: () => {} } })).toBeNull()
  })

  it('forbids a gesture on arm-then-click', () => {
    expect(canvasToolDeclError({ ...base, gesture: { onEnd: () => {} } })).toMatch(/only legal on a drag/)
  })

  it('lets an ephemeral tool omit renderFace, but no other interaction', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructuring away renderFace is the point of the case
    const { renderFace: _rf, ...faceless } = base
    expect(canvasToolDeclError({ ...faceless, interaction: 'ephemeral-drag', gesture: { onEnd: () => {} } })).toBeNull()
    expect(canvasToolDeclError({ ...faceless })).toMatch(/renderFace/)
  })

  it('rejects unknown interaction and style field shapes', () => {
    expect(canvasToolDeclError({ ...base, interaction: 'hover' as never })).toMatch(/unknown interaction/)
    expect(canvasToolDeclError({ ...base, styleFields: [{ type: 'font' as never, key: 'f', options: ['a'], default: 'a' }] })).toMatch(/unknown style field type/)
    expect(canvasToolDeclError({ ...base, styleFields: [{ type: 'color', key: 'c', options: [], default: '#000' }] })).toMatch(/non-empty options/)
    expect(canvasToolDeclError({ ...base, styleFields: [{ type: 'color', key: 'no spaces!', options: ['#000'], default: '#000' }] })).toMatch(/alphanumeric/)
  })
})

describe('adaptStyleFields', () => {
  it('fills the panel plumbing: kind-derived testids, verbatim group labels, real interpolated width labels', () => {
    const fields = adaptStyleFields('scribble', 'Scribble', [
      { type: 'color', key: 'color', options: ['#111', '#222'], default: '#111' },
      { type: 'stroke-width', key: 'size', options: [2, 4], default: 2 },
      { type: 'stroke-width', key: 'width', render: 'line', options: [1, 2], default: 1 },
      { type: 'color-or-none', key: 'fill', options: ['#333'] },
    ])
    expect(fields[0]).toMatchObject({ type: 'color', testidPrefix: 'atlas-scribble-color', groupLabelKey: 'Scribble color', default: '#111' })
    expect(fields[1]).toMatchObject({ type: 'stroke-width', render: 'dot', optionLabelKey: 'pencilStyle.sizeOption' })
    expect(fields[2]).toMatchObject({ render: 'line', optionLabelKey: 'shapeStyle.widthOption' })
    expect(fields[3]).toMatchObject({ type: 'color-or-none', default: 'none' })
  })
})

describe('styleFieldDefault', () => {
  it('pins color-or-none to none and passes explicit defaults through', () => {
    expect(styleFieldDefault({ type: 'color-or-none', key: 'fill', options: ['#333'] })).toBe('none')
    expect(styleFieldDefault({ type: 'stroke-width', key: 'size', options: [2, 4], default: 4 })).toBe(4)
  })
})

describe('goal 0252 S2 doors', () => {
  it('validates the new identity fields: objectKind slug, single-letter shortcutKey, known group, named glyphs', () => {
    expect(canvasToolDeclError({ ...base, objectKind: 'Ink!' })).toMatch(/lowercase slug/)
    expect(canvasToolDeclError({ ...base, objectKind: 'ink' })).toBeNull()
    expect(canvasToolDeclError({ ...base, shortcutKey: 'PP' })).toMatch(/single A-Z letter/)
    expect(canvasToolDeclError({ ...base, shortcutKey: 'P' })).toBeNull()
    expect(canvasToolDeclError({ ...base, group: 'toolbar' as never })).toMatch(/unknown group/)
    expect(canvasToolDeclError({ ...base, icon: 'pencils' })).toMatch(/not a known glyph/)
    expect(canvasToolDeclError({ ...base, icon: 'pencil' })).toBeNull()
    expect(canvasToolDeclError({ ...base, styleFields: [{ type: 'shape-kind', key: 'type', options: [{ value: 'r', icon: 'not-a-glyph', label: 'R' }], default: 'r' }] })).toMatch(/not a known glyph/)
    expect(canvasToolDeclError({ ...base, styleFields: [{ type: 'shape-kind', key: 'type', options: [{ value: 'r', icon: 'square', label: 'R' }], default: 'r' }] })).toBeNull()
  })

  it('lockable is only legal on a non-sticky drag tool', () => {
    expect(canvasToolDeclError({ ...base, interaction: 'drag-to-draw', gesture: { onEnd: () => {} }, lockable: true })).toMatch(/sticky: false/)
    expect(canvasToolDeclError({ ...base, interaction: 'drag-to-draw', gesture: { onEnd: () => {} }, sticky: false, lockable: true })).toBeNull()
  })

  // Regression: a stray armed click also reaches onEnd (the engine
  // fires it unconditionally), and an unconditional host disarm there
  // unmounted the tray button out from under that same click's own
  // toggle -- the lock-on-re-click convention broke. The host disarm
  // is gated on the engine's shared drag threshold instead.
  it('host-owned disarm fires only after a real drag, never on a stray click', () => {
    const calls: string[] = []
    const ctx = {
      screenToFlowPosition: (p: { x: number; y: number }) => p,
      parentID: '', cardBoxes: [], noteBoxes: [], objectBoxes: [],
      onDeleteSelection: () => {}, openAreaPopover: () => {}, onShapeCreated: () => {}, enclosedIn: () => ({ cardIDs: [], noteIDs: [], objectIDs: [] }),
      disarm: () => calls.push('disarm'),
      disarmUnlessLocked: () => calls.push('disarmUnlessLocked'),
      hitAccumulator: { cardIDs: new Set<string>(), noteIDs: new Set<string>(), objectIDs: new Set<string>() },
    }
    const gesture = adaptGesture('thing', 'thing', [], { onEnd: () => {} }, false, false)
    gesture.onEnd([{ x: 5, y: 5, t: 0 }], ctx)
    expect(calls).toEqual([])
    gesture.onEnd([{ x: 5, y: 5, t: 0 }, { x: 40, y: 40, t: 1 }], ctx)
    expect(calls).toEqual(['disarmUnlessLocked'])
  })

  it('a sticky drag tool never receives a host disarm at all', () => {
    const calls: string[] = []
    const ctx = {
      screenToFlowPosition: (p: { x: number; y: number }) => p,
      parentID: '', cardBoxes: [], noteBoxes: [], objectBoxes: [],
      onDeleteSelection: () => {}, openAreaPopover: () => {}, onShapeCreated: () => {}, enclosedIn: () => ({ cardIDs: [], noteIDs: [], objectIDs: [] }),
      disarm: () => calls.push('disarm'),
      disarmUnlessLocked: () => calls.push('disarmUnlessLocked'),
      hitAccumulator: { cardIDs: new Set<string>(), noteIDs: new Set<string>(), objectIDs: new Set<string>() },
    }
    const gesture = adaptGesture('thing', 'thing', [], { onEnd: () => {} }, true, false)
    gesture.onEnd([{ x: 0, y: 0, t: 0 }, { x: 90, y: 90, t: 1 }], ctx)
    expect(calls).toEqual([])
  })

  it('the erase doors exist only when the manifest capability grants them', () => {
    const probeCtx = (canErase: boolean) => {
      let seen: { eraseHitTest: boolean; commitErase: boolean } | null = null
      const gesture = adaptGesture('thing', 'thing', [], {
        onEnd: (_pts, ctx) => { seen = { eraseHitTest: typeof ctx.eraseHitTest === 'function', commitErase: typeof ctx.commitErase === 'function' } },
      }, true, canErase)
      gesture.onEnd([{ x: 0, y: 0, t: 0 }], {
        screenToFlowPosition: (p: { x: number; y: number }) => p,
        parentID: '', cardBoxes: [], noteBoxes: [], objectBoxes: [],
        onDeleteSelection: () => {}, openAreaPopover: () => {}, onShapeCreated: () => {}, enclosedIn: () => ({ cardIDs: [], noteIDs: [], objectIDs: [] }),
        disarm: () => {}, disarmUnlessLocked: () => {},
        hitAccumulator: { cardIDs: new Set<string>(), noteIDs: new Set<string>(), objectIDs: new Set<string>() },
      })
      return seen
    }
    expect(probeCtx(false)).toEqual({ eraseHitTest: false, commitErase: false })
    expect(probeCtx(true)).toEqual({ eraseHitTest: true, commitErase: true })
  })
})

describe('goal 0310 doors', () => {
  it('itemsInRect answers through the host enclosure query, in the SDK\'s own id names', () => {
    let seen: { cardIds: string[]; noteIds: string[]; objectIds: string[] } | null = null
    const gesture = adaptGesture('thing', 'thing', [], {
      onEnd: (_pts, ctx) => { seen = ctx.itemsInRect({ x: 0, y: 0, width: 10, height: 10 }) },
    }, true, false)
    gesture.onEnd([{ x: 0, y: 0, t: 0 }], {
      screenToFlowPosition: (p: { x: number; y: number }) => p,
      parentID: '', cardBoxes: [], noteBoxes: [], objectBoxes: [],
      onDeleteSelection: () => {}, openAreaPopover: () => {}, onShapeCreated: () => {},
      enclosedIn: (rect) => ({ cardIDs: [`c@${rect.width}`], noteIDs: ['n1'], objectIDs: [] }),
      disarm: () => {}, disarmUnlessLocked: () => {},
      hitAccumulator: { cardIDs: new Set<string>(), noteIDs: new Set<string>(), objectIDs: new Set<string>() },
    })
    expect(seen).toEqual({ cardIds: ['c@10'], noteIds: ['n1'], objectIds: [] })
  })

  it('a resolver editRoute is asked per object; an unknown answer means no edit door', () => {
    const noun = buildThirdPartyNoun('p', { id: 'p', name: 'P', version: '1' } as never, {
      ...base, source: 'file',
      editRoute: (o) => (o.Payload.mirrorPath?.endsWith('.txt') ? 'inline' : o.Payload.mirrorPath ? 'external-app' : ('bogus' as never)),
    })
    const decl = noun.content?.editRoute
    if (!decl) throw new Error('no content')
    const obj = (mirrorPath?: string) => ({ ID: 'o', Kind: 'thing', Payload: mirrorPath ? { mirrorPath } : {} }) as unknown as BoardObject
    expect(resolveEditRoute(obj('/a.txt'), decl)).toEqual({ kind: 'inline' })
    expect(resolveEditRoute(obj('/a.bin'), decl)).toEqual({ kind: 'external-app' })
    expect(resolveEditRoute(obj(), decl)).toEqual({ kind: 'none' })
  })
})
