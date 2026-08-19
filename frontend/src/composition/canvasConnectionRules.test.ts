import { describe, expect, it } from 'vitest'
import { EffectClass } from '../../bindings/github.com/alicoding/mill/internal/domain/guardrail/models'
import { Complexity, NodeKind, PayloadKind, type NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode } from './canvasStore'
import { connectionRefusalReason, isValidCanvasConnection } from './canvasConnectionRules'

function node(id: string, kind: string, nodeTypeID = `${kind}-x`, label = kind): CanvasNode {
  return { id, type: kind, position: { x: 0, y: 0 }, data: { nodeTypeID, kind, label, config: {} } }
}

// Same minimal-fixture shape as payloadKinds.test.ts's own nodeType()
// helper -- kept local since this file exercises a different field mix
// (Consumes/Produces/Kind) than that one's own test cases.
function nodeType(overrides: Partial<NodeType>): NodeType {
  return {
    ID: 'x', Kind: NodeKind.KindProcess, Label: 'X', Description: '',
    ConfigFields: [], Output: '', Consumes: [], Produces: {},
    Effect: EffectClass.ClassNone, Declared: false, PaletteGroup: '',
    Complexity: Complexity.ComplexityBasic,
    ...overrides,
  }
}

describe('isValidCanvasConnection', () => {
  it('rejects an outgoing edge from a terminal node', () => {
    const nodes = [node('a', 'terminal'), node('b', 'apply')]
    expect(isValidCanvasConnection(nodes, [], { source: 'a', target: 'b', sourceHandle: null, targetHandle: null })).toBe(false)
  })

  it('rejects a second outgoing edge from a non-Decision node', () => {
    const nodes = [node('a', 'apply'), node('b', 'process'), node('c', 'process')]
    const edges = [{ id: 'e1', source: 'a', target: 'b' }]
    expect(isValidCanvasConnection(nodes, edges, { source: 'a', target: 'c', sourceHandle: null, targetHandle: null })).toBe(false)
  })

  it('allows a second outgoing edge from a Decision node', () => {
    const nodes = [node('a', 'decision'), node('b', 'process'), node('c', 'process')]
    const edges = [{ id: 'e1', source: 'a', target: 'b' }]
    expect(isValidCanvasConnection(nodes, edges, { source: 'a', target: 'c', sourceHandle: null, targetHandle: null })).toBe(true)
  })

  it('rejects an edge into a trigger node', () => {
    const nodes = [node('a', 'apply'), node('b', 'trigger')]
    expect(isValidCanvasConnection(nodes, [], { source: 'a', target: 'b', sourceHandle: null, targetHandle: null })).toBe(false)
  })

  it('allows an ordinary edge with no conflicting rule', () => {
    const nodes = [node('a', 'apply'), node('b', 'process')]
    expect(isValidCanvasConnection(nodes, [], { source: 'a', target: 'b', sourceHandle: null, targetHandle: null })).toBe(true)
  })
})

describe('connectionRefusalReason', () => {
  const captureHTML = nodeType({ ID: 'capture-clipboard-html', Kind: NodeKind.KindCapture, Consumes: [PayloadKind.PayloadNone], Produces: { kind: PayloadKind.PayloadHTML } })
  const convertHTMLToMarkdown = nodeType({ ID: 'process-html-to-markdown', Kind: NodeKind.KindProcess, Consumes: [PayloadKind.PayloadHTML], Produces: { kind: PayloadKind.PayloadMarkdown } })
  const writeText = nodeType({ ID: 'apply-clipboard-write-text', Kind: NodeKind.KindApply, Consumes: [PayloadKind.PayloadText], Produces: { passthrough: true } })
  const notify = nodeType({ ID: 'apply-notify', Kind: NodeKind.KindApply, Consumes: [PayloadKind.PayloadNone], Produces: { passthrough: true } })
  const triggerManual = nodeType({ ID: 'trigger-manual', Kind: NodeKind.KindTrigger, Consumes: [PayloadKind.PayloadNone], Produces: { kind: PayloadKind.PayloadNone } })
  const ruleset = nodeType({ ID: 'ruleset', Kind: NodeKind.KindApply, Consumes: [PayloadKind.PayloadNone], Produces: { passthrough: true } })

  const typesById = new Map<string, NodeType>([
    [captureHTML.ID, captureHTML],
    [convertHTMLToMarkdown.ID, convertHTMLToMarkdown],
    [writeText.ID, writeText],
    [notify.ID, notify],
    [triggerManual.ID, triggerManual],
    [ruleset.ID, ruleset],
  ])

  it('refuses the double-convert pair -- the second converter needs HTML but receives Markdown', () => {
    const nodes = [
      node('c', 'capture', captureHTML.ID, 'Read clipboard'),
      node('p1', 'process', convertHTMLToMarkdown.ID, 'Convert HTML to Markdown'),
      node('p2', 'process', convertHTMLToMarkdown.ID, 'Convert HTML to Markdown'),
    ]
    const edges = [{ id: 'e1', source: 'c', target: 'p1' }]
    const reason = connectionRefusalReason(nodes, edges, { source: 'p1', target: 'p2', sourceHandle: null, targetHandle: null }, typesById)
    expect(reason).toContain('needs HTML')
    expect(reason).toContain('produces Markdown')
  })

  it('allows every edge of the seeded clipboard chain', () => {
    const nodes = [
      node('t', 'trigger', triggerManual.ID, 'Manual run'),
      node('c', 'capture', captureHTML.ID, 'Read clipboard'),
      node('p', 'process', convertHTMLToMarkdown.ID, 'Convert HTML to Markdown'),
      node('a', 'apply', writeText.ID, 'Write text to clipboard'),
      node('n', 'apply', notify.ID, 'Notify me'),
    ]
    const chainEdges = [
      { id: 'e0', source: 't', target: 'c' },
      { id: 'e1', source: 'c', target: 'p' },
      { id: 'e2', source: 'p', target: 'a' },
      { id: 'e3', source: 'a', target: 'n' },
    ]
    for (const edge of chainEdges) {
      const rest = chainEdges.filter((e) => e.id !== edge.id)
      expect(connectionRefusalReason(nodes, rest, { source: edge.source, target: edge.target, sourceHandle: null, targetHandle: null }, typesById)).toBeNull()
    }
  })

  it('resolves through a passthrough node in the middle before refusing/allowing', () => {
    // capture(html) -> ruleset (passthrough) -> convert(needs html): still
    // allowed, since the passthrough forwards the capture's real html.
    const nodes = [
      node('c', 'capture', captureHTML.ID, 'Read clipboard'),
      node('r', 'apply', ruleset.ID, 'Apply ruleset'),
      node('p', 'process', convertHTMLToMarkdown.ID, 'Convert HTML to Markdown'),
    ]
    const edges = [{ id: 'e1', source: 'c', target: 'r' }]
    expect(connectionRefusalReason(nodes, edges, { source: 'r', target: 'p', sourceHandle: null, targetHandle: null }, typesById)).toBeNull()
  })
})
