import { describe, expect, it } from 'vitest'
import {
  CanvasProtocolError,
  MEASURE_MAX_WIDTH,
  parseObjectCommit,
  parseObjectCreate,
  parseObjectMeasure,
  parseObjectPatch,
  parseRegisterTool,
  parseToolPointer,
  toolWireDescriptor,
} from './canvasToolProtocol'
import type { CanvasToolDecl } from './sdk/canvasTools'

// The wire contract's own refusals (docs/goals/0380 Decision 2). A
// frame is untrusted input, so the property under test is not "a good
// message parses" but "a bad one is refused BY NAME, with nothing
// coerced into a plausible shape".

const TOOL = {
  kind: 'pencil',
  objectKind: 'ink',
  label: 'Draw with the pencil',
  icon: 'pencil',
  cursor: 'crosshair',
  shortcutKey: 'P',
  group: 'annotate',
  source: 'file',
  editRoute: 'none',
  preview: { kind: 'path', from: 'trail', fill: 'trailFill' },
}

function fieldOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    if (err instanceof CanvasProtocolError) return err.field
    return `not a protocol error: ${String(err)}`
  }
  return 'no error'
}

describe('register.tool', () => {
  it('accepts a full declaration and fills the fields a tool left out', () => {
    const parsed = parseRegisterTool(TOOL)
    expect(parsed.kind).toBe('pencil')
    expect(parsed.objectKind).toBe('ink')
    expect(parsed.ephemeral).toBe(false)
    expect(parsed.styleFields).toEqual([])
    expect(parsed.preview).toEqual({ kind: 'path', from: 'trail', fill: 'trailFill', stroke: undefined, strokeWidth: undefined, opacity: undefined })
  })

  it('names the field it refused, never "invalid message"', () => {
    expect(fieldOf(() => parseRegisterTool({ ...TOOL, kind: 'Pencil' }))).toBe('kind')
    expect(fieldOf(() => parseRegisterTool({ ...TOOL, label: 7 }))).toBe('label')
    expect(fieldOf(() => parseRegisterTool({ ...TOOL, shortcutKey: 'pp' }))).toBe('shortcutKey')
    expect(fieldOf(() => parseRegisterTool({ ...TOOL, cursor: 'wiggle' }))).toBe('cursor')
    expect(fieldOf(() => parseRegisterTool({ ...TOOL, group: 'nowhere' }))).toBe('group')
    expect(fieldOf(() => parseRegisterTool({ ...TOOL, preview: { kind: 'blob', from: 'x' } }))).toBe('preview.kind')
    expect(fieldOf(() => parseRegisterTool('pencil'))).toBe('register.tool')
  })

  it('carries a declaration to the wire without its handler, which cannot cross', () => {
    const decl = { ...TOOL, onPointer: () => {} } as unknown as CanvasToolDecl
    const wire = toolWireDescriptor(decl)
    expect('onPointer' in wire).toBe(false)
    expect(parseRegisterTool(wire).kind).toBe('pencil')
  })
})

describe('the object doors', () => {
  it('keeps a draft’s payload flat strings, since anything else never survives storage', () => {
    const created = parseObjectCreate({ toolId: 'shape', kind: 'shape', at: { x: 1, y: 2 }, data: { title: 'Rectangle' }, preview: { live: '[]' } })
    expect(created).toEqual({ toolId: 'shape', kind: 'shape', at: { x: 1, y: 2 }, size: undefined, data: { title: 'Rectangle' }, preview: { live: '[]' } })
    expect(fieldOf(() => parseObjectCreate({ toolId: 'shape', kind: 'shape', at: { x: 1, y: 2 }, data: { n: 3 } }))).toBe('data.n')
    expect(fieldOf(() => parseObjectCreate({ toolId: 'shape', kind: 'shape', at: { x: 1 } }))).toBe('at.y')
    expect(fieldOf(() => parseObjectCreate({ toolId: 'shape', kind: 'shape', at: { x: 1, y: Infinity } }))).toBe('at.y')
  })

  it('takes a patch of any subset, and refuses one naming no draft', () => {
    expect(parseObjectPatch({ id: 'd1', preview: { trail: 'M0 0' } })).toEqual({ id: 'd1', at: undefined, size: undefined, data: undefined, preview: { trail: 'M0 0' } })
    expect(fieldOf(() => parseObjectPatch({ preview: {} }))).toBe('id')
    expect(fieldOf(() => parseObjectPatch({ id: 'd1', size: { w: 1 } }))).toBe('size.h')
  })

  it('defaults commit to leaving the placed object unselected', () => {
    expect(parseObjectCommit({ id: 'd1' })).toEqual({ id: 'd1', select: false })
    expect(parseObjectCommit({ id: 'd1', select: true })).toEqual({ id: 'd1', select: true })
    expect(fieldOf(() => parseObjectCommit({ id: 'd1', select: 'yes' }))).toBe('select')
  })

  it('bounds a measuring width, since the host lays the markup out on its own main thread', () => {
    expect(parseObjectMeasure({ markup: '<p>hi</p>', maxWidth: 320 })).toEqual({ markup: '<p>hi</p>', maxWidth: 320 })
    expect(fieldOf(() => parseObjectMeasure({ markup: '<p>hi</p>', maxWidth: 0 }))).toBe('maxWidth')
    expect(fieldOf(() => parseObjectMeasure({ markup: '<p>hi</p>', maxWidth: MEASURE_MAX_WIDTH + 1 }))).toBe('maxWidth')
  })
})

describe('tool.pointer', () => {
  const POINTER = {
    toolId: 'pencil',
    phase: 'move',
    point: { x: 4, y: 5, t: 100 },
    coalesced: [{ x: 3, y: 4, t: 99 }],
    modifiers: { shift: true, alt: false, ctrl: false, meta: false },
    zoom: 0.5,
    styleValues: { color: '#fff', size: 4 },
  }

  it('carries the newest sample plus the ones folded into the same frame', () => {
    const parsed = parseToolPointer(POINTER)
    expect(parsed.point).toEqual({ x: 4, y: 5, t: 100 })
    expect(parsed.coalesced).toEqual([{ x: 3, y: 4, t: 99 }])
    expect(parsed.modifiers.shift).toBe(true)
    expect(parsed.styleValues).toEqual({ color: '#fff', size: 4 })
  })

  it('refuses a phase it does not drive, and a style value that is neither text nor a number', () => {
    expect(fieldOf(() => parseToolPointer({ ...POINTER, phase: 'hover' }))).toBe('phase')
    expect(parseToolPointer({ ...POINTER, styleValues: { color: {} } }).styleValues).toEqual({})
  })
})
