import { describe, expect, it } from 'vitest'
import { matchFacetSuggestions, parseFacetQuery } from './facetQuery'
import type { FacetVocabEntry } from './facetQuery'

const VOCAB: FacetVocabEntry[] = [
  { key: 'workflow', label: 'Workflow' },
  { key: 'mcpServer', label: 'MCP server' },
  { key: 'setting', label: 'Setting', aliases: ['settings'] },
]

describe('parseFacetQuery', () => {
  it('returns no scope and the whole query when there is no colon', () => {
    expect(parseFacetQuery('echo', VOCAB)).toEqual({ text: 'echo' })
  })

  it('scopes on an exact, case-insensitive label match', () => {
    expect(parseFacetQuery('workflow: echo', VOCAB)).toEqual({ scopeKey: 'workflow', text: 'echo' })
    expect(parseFacetQuery('WORKFLOW: echo', VOCAB)).toEqual({ scopeKey: 'workflow', text: 'echo' })
    expect(parseFacetQuery('WorkFlow: echo', VOCAB)).toEqual({ scopeKey: 'workflow', text: 'echo' })
  })

  it('matches a multi-word label only when typed in full', () => {
    expect(parseFacetQuery('mcp server: prod', VOCAB)).toEqual({ scopeKey: 'mcpServer', text: 'prod' })
    // "mcp" alone is not the whole label -- falls through to unscoped.
    expect(parseFacetQuery('mcp: prod', VOCAB)).toEqual({ text: 'mcp: prod' })
  })

  it('matches an alias the same as the primary label', () => {
    expect(parseFacetQuery('settings: theme', VOCAB)).toEqual({ scopeKey: 'setting', text: 'theme' })
  })

  it('trims leading whitespace off the text but preserves internal spacing', () => {
    expect(parseFacetQuery('workflow:    echo   test', VOCAB)).toEqual({ scopeKey: 'workflow', text: 'echo   test' })
  })

  it('treats empty text after the token as valid (list-all)', () => {
    expect(parseFacetQuery('workflow: ', VOCAB)).toEqual({ scopeKey: 'workflow', text: '' })
    expect(parseFacetQuery('workflow:', VOCAB)).toEqual({ scopeKey: 'workflow', text: '' })
  })

  it('leaves a query with a non-matching prefix before the colon fully unscoped', () => {
    expect(parseFacetQuery('look at ada: page 5', VOCAB)).toEqual({ text: 'look at ada: page 5' })
  })

  it('only ever considers the FIRST colon -- a later one stays inside text once scoped', () => {
    expect(parseFacetQuery('workflow: sync at 10:30', VOCAB)).toEqual({ scopeKey: 'workflow', text: 'sync at 10:30' })
  })

  it('returns unscoped for an empty or whitespace-only query', () => {
    expect(parseFacetQuery('', VOCAB)).toEqual({ text: '' })
    expect(parseFacetQuery('   ', VOCAB)).toEqual({ text: '   ' })
  })

  it('does not scope on a bare colon with no label text before it', () => {
    expect(parseFacetQuery(': echo', VOCAB)).toEqual({ text: ': echo' })
  })

  it('returns unscoped when the vocabulary is empty', () => {
    expect(parseFacetQuery('workflow: echo', [])).toEqual({ text: 'workflow: echo' })
  })
})

describe('matchFacetSuggestions', () => {
  it('returns vocabulary entries whose label prefix-matches the first typed word', () => {
    expect(matchFacetSuggestions('work', VOCAB).map((v) => v.key)).toEqual(['workflow'])
  })

  it('matches case-insensitively', () => {
    expect(matchFacetSuggestions('WORK', VOCAB).map((v) => v.key)).toEqual(['workflow'])
  })

  it('matches a multi-word label off its first word alone', () => {
    expect(matchFacetSuggestions('mcp', VOCAB).map((v) => v.key)).toEqual(['mcpServer'])
  })

  it('keeps matching once the query has moved past the first word', () => {
    expect(matchFacetSuggestions('work in progress', VOCAB).map((v) => v.key)).toEqual(['workflow'])
  })

  it('returns nothing for an empty query', () => {
    expect(matchFacetSuggestions('', VOCAB)).toEqual([])
  })

  it('returns nothing when no label prefix-matches', () => {
    expect(matchFacetSuggestions('zzz', VOCAB)).toEqual([])
  })

  it('caps results at max (default 5)', () => {
    const bigVocab: FacetVocabEntry[] = Array.from({ length: 8 }, (_, i) => ({ key: `k${i}`, label: `Kind${i}` }))
    expect(matchFacetSuggestions('kind', bigVocab)).toHaveLength(5)
    expect(matchFacetSuggestions('kind', bigVocab, 3)).toHaveLength(3)
  })
})
