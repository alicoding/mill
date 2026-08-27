import { describe, expect, it } from 'vitest'
import { searchDocs } from './docsSearch'
import type { DocSearchEntry } from '../shared/bindings'

const ENTRIES: DocSearchEntry[] = [
  { rel: 'start-here/what-is-mill.md', title: 'What is Mill', text: 'Mill is a desktop app for guardrailed automation.' },
  { rel: 'reference/steps.md', title: 'Step reference', text: 'Convert HTML to Markdown preserves structure like tables and lists.' },
  { rel: 'concepts/guardrails.md', title: 'Guardrails and effect classes', text: 'What asks for approval and how rules scope it.' },
]

describe('searchDocs', () => {
  it('returns nothing for a blank query', () => {
    expect(searchDocs(ENTRIES, '  ')).toEqual([])
  })

  it('matches a page by title text, case-insensitively', () => {
    const got = searchDocs(ENTRIES, 'GUARDRAILS')
    expect(got.map((r) => r.rel)).toEqual(['concepts/guardrails.md'])
  })

  it('matches a page by body text alone and includes a snippet', () => {
    const got = searchDocs(ENTRIES, 'Convert HTML to Markdown')
    expect(got).toHaveLength(1)
    expect(got[0].rel).toBe('reference/steps.md')
    expect(got[0].snippet).toContain('Convert HTML to Markdown')
  })

  it('ranks a title match ahead of a body-only match', () => {
    // "Mill" is in the title of the first entry and only in the body
    // prose of the others via the word "guardrailed"/"rules" -- pick a
    // query that hits one title and one body to prove ordering.
    const entries: DocSearchEntry[] = [
      { rel: 'a.md', title: 'Body only', text: 'the word target appears here' },
      { rel: 'b.md', title: 'Title has target in it', text: 'unrelated body text' },
    ]
    const got = searchDocs(entries, 'target')
    expect(got.map((r) => r.rel)).toEqual(['b.md', 'a.md'])
  })

  it('truncates a long-body snippet around the match with ellipses on both sides', () => {
    const padding = 'x'.repeat(200)
    const fullText = `${padding} needle ${padding}`
    const entries: DocSearchEntry[] = [{ rel: 'a.md', title: 'A', text: fullText }]
    const got = searchDocs(entries, 'needle')
    expect(got[0].snippet.startsWith('…')).toBe(true)
    expect(got[0].snippet.endsWith('…')).toBe(true)
    expect(got[0].snippet).toContain('needle')
    expect(got[0].snippet.length).toBeLessThan(fullText.length)
  })

  it('finds no results for a query absent from every page', () => {
    expect(searchDocs(ENTRIES, 'nonexistent-phrase-xyz')).toEqual([])
  })
})
