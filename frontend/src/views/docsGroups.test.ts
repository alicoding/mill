import { describe, expect, it } from 'vitest'
import { adjacentPages, groupDocsIndex, sectionTitleKey } from './docsGroups'

const INDEX = [
  { rel: 'start-here/what-is-mill.md', title: 'What is Mill', note: '' },
  { rel: 'start-here/install.md', title: 'Install', note: '' },
  { rel: 'concepts/workflows-and-steps.md', title: 'Workflows and steps', note: '' },
  { rel: 'concepts/guardrails.md', title: 'Guardrails and effect classes', note: '' },
  { rel: 'reference/steps.md', title: 'Step reference', note: '' },
]

describe('groupDocsIndex', () => {
  it('buckets entries by their rel path directory, one group per directory', () => {
    const groups = groupDocsIndex(INDEX)
    expect(groups.map((g) => g.dir)).toEqual(['start-here', 'concepts', 'reference'])
    expect(groups[0].entries.map((e) => e.rel)).toEqual(['start-here/what-is-mill.md', 'start-here/install.md'])
    expect(groups[1].entries.map((e) => e.rel)).toEqual(['concepts/workflows-and-steps.md', 'concepts/guardrails.md'])
  })

  it('orders sections by first appearance in the canonical index, not alphabetically', () => {
    const reordered = [INDEX[4], INDEX[0], INDEX[2]]
    const groups = groupDocsIndex(reordered)
    expect(groups.map((g) => g.dir)).toEqual(['reference', 'start-here', 'concepts'])
  })

  it('resolves each known directory to its locale key', () => {
    const groups = groupDocsIndex(INDEX)
    expect(groups.map((g) => g.titleKey)).toEqual(['docs.sections.startHere', 'docs.sections.concepts', 'docs.sections.reference'])
  })
})

describe('sectionTitleKey', () => {
  it('returns an empty string for a directory outside the known set', () => {
    expect(sectionTitleKey('unknown-dir')).toBe('')
  })
})

describe('adjacentPages', () => {
  it('returns both neighbors for a page in the middle of the flat order', () => {
    expect(adjacentPages(INDEX, 'concepts/workflows-and-steps.md')).toEqual({
      prev: INDEX[1],
      next: INDEX[3],
    })
  })

  it('hides prev at the first page', () => {
    expect(adjacentPages(INDEX, 'start-here/what-is-mill.md')).toEqual({
      prev: undefined,
      next: INDEX[1],
    })
  })

  it('hides next at the last page', () => {
    expect(adjacentPages(INDEX, 'reference/steps.md')).toEqual({
      prev: INDEX[3],
      next: undefined,
    })
  })

  it('returns no neighbors for an unknown page', () => {
    expect(adjacentPages(INDEX, 'nonexistent.md')).toEqual({})
  })
})
