import { describe, expect, it } from 'vitest'
import type { Node as CompNode, Edge as CompEdge } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { NodeKind } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { draftsEqual, type ScratchDraft } from './canvasScratch'

// docs/goals/0025 item 8: canvasScratch's normalize/draftsEqual is
// hot-exit dirty-detection (docs/goals/0012-authoring-hot-exit.md) --
// a false "dirty" reads as data loss risk avoided for no reason
// (annoying, not destructive), but a false "clean" is the real hazard:
// a genuine edit silently never gets offered for restore after a crash
// or reload. Both directions are worth locking down with real tests,
// not just the manual verification the feature originally shipped
// with.

function node(id: string, nodeTypeID: string, config: Record<string, string> | null = {}, x = 0, y = 0): CompNode {
  return { ID: id, Kind: NodeKind.KindTrigger, NodeTypeID: nodeTypeID, Config: config, Position: { X: x, Y: y } }
}

function edge(id: string, source: string, target: string, sourceHandle = ''): CompEdge {
  return { ID: id, Source: source, SourceHandle: sourceHandle, Target: target }
}

function draft(label: string, description: string, nodes: CompNode[], edges: CompEdge[]): ScratchDraft {
  return { label, description, nodes, edges }
}

describe('draftsEqual', () => {
  it('treats an identical draft as equal to itself', () => {
    const d = draft('My workflow', 'desc', [node('t', 'trigger-manual')], [])
    expect(draftsEqual(d, d)).toBe(true)
  })

  it('is ID-agnostic for a structurally identical single-node draft (the fresh-mount false-positive this exists to avoid)', () => {
    // Two independent mounts of the same brand-new, unedited workflow --
    // same node in the same declaration position, but a fresh
    // crypto.randomUUID() each time. Comparing by literal ID would flag
    // this as dirty despite nothing having actually changed.
    const a = draft('New workflow', '', [node('uuid-aaaa', 'trigger-manual')], [])
    const b = draft('New workflow', '', [node('uuid-bbbb', 'trigger-manual')], [])
    expect(draftsEqual(a, b)).toBe(true)
  })

  it('detects a real label change', () => {
    const a = draft('Original', '', [node('t', 'trigger-manual')], [])
    const b = draft('Edited', '', [node('t', 'trigger-manual')], [])
    expect(draftsEqual(a, b)).toBe(false)
  })

  it('detects a real description change', () => {
    const a = draft('wf', 'original description', [node('t', 'trigger-manual')], [])
    const b = draft('wf', 'edited description', [node('t', 'trigger-manual')], [])
    expect(draftsEqual(a, b)).toBe(false)
  })

  it('detects a node type swap even with matching positional index and id', () => {
    const a = draft('wf', '', [node('t', 'trigger-manual')], [])
    const b = draft('wf', '', [node('t', 'trigger-schedule')], [])
    expect(draftsEqual(a, b)).toBe(false)
  })

  it('detects a real config value change on an otherwise-identical node', () => {
    const a = draft('wf', '', [node('n', 'apply-clipboard-write-html', { html: '<p>a</p>' })], [])
    const b = draft('wf', '', [node('n', 'apply-clipboard-write-html', { html: '<p>b</p>' })], [])
    expect(draftsEqual(a, b)).toBe(false)
  })

  it('detects a node position change', () => {
    const a = draft('wf', '', [node('t', 'trigger-manual', {}, 0, 0)], [])
    const b = draft('wf', '', [node('t', 'trigger-manual', {}, 400, 400)], [])
    expect(draftsEqual(a, b)).toBe(false)
  })

  it('treats reordered nodes (same set, different declaration order) as different -- position is part of node identity here, not a set comparison', () => {
    // Deliberately documents the actual behavior rather than assuming a
    // "smarter" set-based comparison: normalize() maps node identity by
    // declaration-order index, so two drafts holding the same two nodes
    // in a different order produce different index-keyed edge/attribute
    // shapes whenever an edge references them (below) -- but even
    // without edges, swapping declaration order changes which node is
    // "index 0" vs "index 1", which draftsEqual treats as a real change.
    const a = draft('wf', '', [node('a', 'trigger-manual'), node('b', 'capture-clipboard-html')], [])
    const b = draft('wf', '', [node('b', 'capture-clipboard-html'), node('a', 'trigger-manual')], [])
    expect(draftsEqual(a, b)).toBe(false)
  })

  it('treats a genuinely identical two-node, edge-connected draft as equal across two independent ID sets', () => {
    const a = draft(
      'wf', '',
      [node('trig-1', 'trigger-manual'), node('cap-1', 'capture-clipboard-html')],
      [edge('e-1', 'trig-1', 'cap-1')],
    )
    const b = draft(
      'wf', '',
      [node('trig-2', 'trigger-manual'), node('cap-2', 'capture-clipboard-html')],
      [edge('e-2', 'trig-2', 'cap-2')],
    )
    expect(draftsEqual(a, b)).toBe(true)
  })

  it('detects an edge target change (rewiring) even when node content is unchanged', () => {
    const nodes = [node('a', 'trigger-manual'), node('b', 'capture-clipboard-html'), node('c', 'process-html-to-markdown')]
    const x = draft('wf', '', nodes, [edge('e1', 'a', 'b')])
    const y = draft('wf', '', nodes, [edge('e1', 'a', 'c')])
    expect(draftsEqual(x, y)).toBe(false)
  })

  it('detects an added edge (edge count differs)', () => {
    const nodes = [node('a', 'trigger-manual'), node('b', 'capture-clipboard-html')]
    const a = draft('wf', '', nodes, [])
    const b = draft('wf', '', nodes, [edge('e1', 'a', 'b')])
    expect(draftsEqual(a, b)).toBe(false)
  })

  it('detects a SourceHandle change on an otherwise identical edge (a Decision branch condition)', () => {
    const nodes = [node('d', 'decision-route'), node('t', 'terminal-node')]
    const a = draft('wf', '', nodes, [edge('e1', 'd', 't', 'Attributes.count > 5')])
    const b = draft('wf', '', nodes, [edge('e1', 'd', 't', 'Attributes.count > 10')])
    expect(draftsEqual(a, b)).toBe(false)
  })

  it('treats undefined nodes/edges the same as an explicitly empty array (a draft with only a label/description)', () => {
    const a: ScratchDraft = { label: 'wf', description: '', nodes: undefined as unknown as CompNode[], edges: undefined as unknown as CompEdge[] }
    const b: ScratchDraft = { label: 'wf', description: '', nodes: [], edges: [] }
    expect(draftsEqual(a, b)).toBe(true)
  })

  it('detects a Config field going from a value to undefined on one node (a cleared field, not a no-op)', () => {
    const a = draft('wf', '', [node('n', 'apply-clipboard-write-html', { html: '<p>x</p>' })], [])
    const b = draft('wf', '', [node('n', 'apply-clipboard-write-html', {})], [])
    expect(draftsEqual(a, b)).toBe(false)
  })

  it('treats a node with Config: null the same across two independently-built drafts', () => {
    const a = draft('wf', '', [node('t', 'trigger-manual', null)], [])
    const b = draft('wf', '', [node('t', 'trigger-manual', null)], [])
    expect(draftsEqual(a, b)).toBe(true)
  })
})
