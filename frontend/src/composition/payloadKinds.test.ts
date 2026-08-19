import { describe, expect, it } from 'vitest'
import { EffectClass } from '../../bindings/github.com/alicoding/mill/internal/domain/guardrail/models'
import { Complexity, NodeKind, PayloadKind, type NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { consumesAccepts, contractLine, describeKind, effectivePayloadKind, type EffectiveKindEdge } from './payloadKinds'

// Minimal NodeType fixture -- every field NodeType requires gets a
// harmless default, overridden per test with only what that test
// actually varies (the same shape canvasConnectionRules.test.ts's own
// node() helper uses for CanvasNode).
function nodeType(overrides: Partial<NodeType>): NodeType {
  return {
    ID: 'x', Kind: NodeKind.KindProcess, Label: 'X', Description: '',
    ConfigFields: [], Output: '', Consumes: [], Produces: {},
    Effect: EffectClass.ClassNone, Declared: false, PaletteGroup: '',
    Complexity: Complexity.ComplexityBasic,
    ...overrides,
  }
}

describe('consumesAccepts', () => {
  // Mirrors internal/domain/composition/payloadkind_test.go's
  // TestConsumesAccepts case-for-case.
  const cases: [string, PayloadKind[], PayloadKind, boolean][] = [
    ['reads-nothing accepts anything', [PayloadKind.PayloadNone], PayloadKind.PayloadHTML, true],
    ['reads-nothing accepts none', [PayloadKind.PayloadNone], PayloadKind.PayloadNone, true],
    ['any accepts none', [PayloadKind.PayloadAny], PayloadKind.PayloadNone, true],
    ['text accepts html', [PayloadKind.PayloadText], PayloadKind.PayloadHTML, true],
    ['text accepts markdown', [PayloadKind.PayloadText], PayloadKind.PayloadMarkdown, true],
    ['text accepts json', [PayloadKind.PayloadText], PayloadKind.PayloadJSON, true],
    ['html refuses markdown', [PayloadKind.PayloadHTML], PayloadKind.PayloadMarkdown, false],
    ['empty producer is universally accepted', [PayloadKind.PayloadHTML], PayloadKind.PayloadNone, true],
    ['html accepts any-producer', [PayloadKind.PayloadHTML], PayloadKind.PayloadAny, true],
    ['optional text accepts none', [PayloadKind.PayloadText, PayloadKind.PayloadNone], PayloadKind.PayloadNone, true],
    ['optional text accepts markdown', [PayloadKind.PayloadText, PayloadKind.PayloadNone], PayloadKind.PayloadMarkdown, true],
    ['json refuses html', [PayloadKind.PayloadJSON], PayloadKind.PayloadHTML, false],
  ]
  it.each(cases)('%s', (_name, consumes, produced, want) => {
    expect(consumesAccepts(consumes, produced)).toBe(want)
  })
})

describe('effectivePayloadKind', () => {
  it('resolves through a passthrough chain to the nearest real producer', () => {
    // trigger-manual -> capture-clipboard-html -> ruleset (passthrough)
    // -> apply-notify (passthrough): mirrors
    // TestEffectivePayloadKind_ResolvesThroughPassthroughChains.
    const byId: Record<string, NodeType> = {
      t: nodeType({ ID: 't', Kind: NodeKind.KindTrigger, Consumes: [PayloadKind.PayloadNone], Produces: { kind: PayloadKind.PayloadNone } }),
      c: nodeType({ ID: 'c', Kind: NodeKind.KindCapture, Consumes: [PayloadKind.PayloadNone], Produces: { kind: PayloadKind.PayloadHTML } }),
      r: nodeType({ ID: 'r', Kind: NodeKind.KindApply, Consumes: [PayloadKind.PayloadNone], Produces: { passthrough: true } }),
      n: nodeType({ ID: 'n', Kind: NodeKind.KindApply, Consumes: [PayloadKind.PayloadNone], Produces: { passthrough: true } }),
    }
    const incoming: Record<string, EffectiveKindEdge[]> = {
      c: [{ source: 't' }],
      r: [{ source: 'c' }],
      n: [{ source: 'r' }],
    }
    expect(effectivePayloadKind('r', byId, incoming, new Set())).toBe('html')
    expect(effectivePayloadKind('t', byId, incoming, new Set())).toBe('none')
  })

  it('resolves an unknown node to any rather than refusing', () => {
    expect(effectivePayloadKind('missing', {}, {}, new Set())).toBe('any')
  })
})

describe('describeKind', () => {
  it.each([
    ['none', 'nothing'],
    ['any', 'anything'],
    ['html', 'HTML'],
    ['json', 'JSON'],
    ['markdown', 'Markdown'],
    ['text', 'text'],
  ])('%s -> %s', (kind, want) => {
    expect(describeKind(kind)).toBe(want)
  })
})

describe('contractLine', () => {
  it('capture-clipboard-html: reads nothing, produces HTML', () => {
    const nt = nodeType({ Kind: NodeKind.KindCapture, Consumes: [PayloadKind.PayloadNone], Produces: { kind: PayloadKind.PayloadHTML } })
    expect(contractLine(nt)).toBe('→ HTML')
  })

  it('process-html-to-markdown: HTML in, Markdown out', () => {
    const nt = nodeType({ Kind: NodeKind.KindProcess, Consumes: [PayloadKind.PayloadHTML], Produces: { kind: PayloadKind.PayloadMarkdown } })
    expect(contractLine(nt)).toBe('HTML → Markdown')
  })

  it('apply-clipboard-write-text: text in, unchanged out (passthrough)', () => {
    const nt = nodeType({ Kind: NodeKind.KindApply, Consumes: [PayloadKind.PayloadText], Produces: { passthrough: true } })
    expect(contractLine(nt)).toBe('text → unchanged')
  })

  it('trigger-manual: reads nothing, starts empty', () => {
    const nt = nodeType({ Kind: NodeKind.KindTrigger, Consumes: [PayloadKind.PayloadNone], Produces: { kind: PayloadKind.PayloadNone } })
    expect(contractLine(nt)).toBe('→ starts empty')
  })

  it('integration-http: anything in, anything out', () => {
    const nt = nodeType({ Kind: NodeKind.KindProcess, Consumes: [PayloadKind.PayloadAny], Produces: { kind: PayloadKind.PayloadAny } })
    expect(contractLine(nt)).toBe('anything → anything')
  })

  it('apply-notify: reads nothing, unchanged out (passthrough)', () => {
    const nt = nodeType({ Kind: NodeKind.KindApply, Consumes: [PayloadKind.PayloadNone], Produces: { passthrough: true } })
    expect(contractLine(nt)).toBe('→ unchanged')
  })
})
