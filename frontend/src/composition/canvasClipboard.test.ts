import { describe, expect, it } from 'vitest'
import { materializeCanvasClones, parseWorkflowClonePayload, serializeCanvasSelection } from './canvasClipboard'
import type { CanvasNode, CanvasNoteNode } from './canvasStore'
import type { Edge as RFEdge } from '@xyflow/react'

const step = (id: string, kind: string, x: number, y: number, selected: boolean): CanvasNode => ({
  id, type: kind, position: { x, y }, selected,
  data: { nodeTypeID: `nt-${id}`, kind, label: id, config: { a: '1' } },
})
const edge = (id: string, source: string, target: string): RFEdge => ({ id, source, target })

describe('serializeCanvasSelection', () => {
  it('copies selected non-trigger steps with set-scoped edges and relative positions', () => {
    const nodes = [step('t', 'trigger', 0, 0, true), step('a', 'process', 100, 50, true), step('b', 'apply', 300, 50, true), step('c', 'process', 500, 500, false)]
    const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 't', 'a')]
    const p = serializeCanvasSelection(nodes, edges, [])!
    expect(p.nodes.map((n) => n.data.label)).toEqual(['a', 'b'])
    // Only a->b survives: b->c leaves the set, t->a starts at the
    // never-copied trigger.
    expect(p.edges).toHaveLength(1)
    expect(p.edges[0]).toMatchObject({ source: 0, target: 1 })
    expect(p.nodes[0]).toMatchObject({ dx: 0, dy: 0 })
    expect(p.nodes[1]).toMatchObject({ dx: 200, dy: 0 })
  })

  it('returns null for an empty or trigger-only selection', () => {
    expect(serializeCanvasSelection([step('t', 'trigger', 0, 0, true)], [], [])).toBeNull()
    expect(serializeCanvasSelection([step('a', 'process', 0, 0, false)], [], [])).toBeNull()
  })

  it('round-trips through parse and materializes at the cursor with fresh ids', () => {
    const notes: CanvasNoteNode[] = [{ id: 'n1', type: 'note', position: { x: 150, y: 100 }, selected: true, data: { text: 'hi', color: 'yellow' }, width: 180, height: 90 }]
    const p = serializeCanvasSelection([step('a', 'process', 100, 100, true)], [], notes)!
    const parsed = parseWorkflowClonePayload(JSON.stringify(p))!
    let n = 0
    const out = materializeCanvasClones(parsed, { x: 1000, y: 2000 }, () => `id-${n++}`)
    expect(out.nodes[0].position).toEqual({ x: 1000, y: 2000 })
    expect(out.nodes[0].id).toBe('id-0')
    expect(out.nodes[0].type).toBe('process')
    expect(out.nodes[0].selected).toBe(true)
    expect(out.notes[0].position).toEqual({ x: 1050, y: 2000 })
    expect(out.notes[0].width).toBe(180)
  })

  it('parse refuses other JSON, prose, and other surfaces', () => {
    expect(parseWorkflowClonePayload('just words')).toBeNull()
    expect(parseWorkflowClonePayload('{"a":1}')).toBeNull()
    expect(parseWorkflowClonePayload(JSON.stringify({ mill: 'clone', surface: 'atlas', v: 1, cards: [] }))).toBeNull()
  })
})
