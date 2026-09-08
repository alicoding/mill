import { describe, expect, it } from 'vitest'
import { Complexity, type NodeType, type Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { exampleMatches, nodeTypeMatchesQuery } from './nodePaletteFilter'

function nodeType(label: string): NodeType {
  return { Label: label, Complexity: Complexity.ComplexityBasic } as NodeType
}

function workflow(id: string, label: string, description: string): Workflow {
  return { ID: id, Label: label, Description: description } as Workflow
}

describe('nodeTypeMatchesQuery', () => {
  it('matches everything for an empty query, in original order', () => {
    const types = [nodeType('AI: Classify'), nodeType('List: lookup')]
    expect(types.filter((nt) => nodeTypeMatchesQuery(nt, ''))).toEqual(types)
  })

  it('matches a plain substring against the full label', () => {
    expect(nodeTypeMatchesQuery(nodeType('AI: Classify'), 'classify')).toBe(true)
  })

  it('matches a typo\'d query a substring test would miss', () => {
    expect('classify'.includes('clasify')).toBe(false)
    expect(nodeTypeMatchesQuery(nodeType('AI: Classify'), 'clasify')).toBe(true)
  })

  it('rejects a query with no relation to the label', () => {
    expect(nodeTypeMatchesQuery(nodeType('AI: Classify'), 'zzz-no-such-step')).toBe(false)
  })
})

describe('exampleMatches', () => {
  it('returns nothing for an empty query', () => {
    expect(exampleMatches([workflow('w1', 'Clipboard to Markdown', 'Converts clipboard content')], '')).toEqual([])
  })

  it('matches a typo\'d query against the label+description', () => {
    const w = workflow('w1', 'Markdown', 'Convert')
    expect('markdown convert'.includes('makdown')).toBe(false)
    expect(exampleMatches([w], 'makdown')).toEqual([w])
  })
})
