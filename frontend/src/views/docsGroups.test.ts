import { describe, expect, it } from 'vitest'
import { adjacentPages, groupDocsIndex, groupOf, groupTitleKey } from './docsGroups'

const INDEX = [
  { rel: 'start-here/what-is-mill.md', title: 'What is Mill', note: '', kind: 'explanation' },
  { rel: 'start-here/install.md', title: 'Install', note: '', kind: 'how-to' },
  { rel: 'reference/install-a-plugin.md', title: 'Install a plugin', note: '', kind: 'how-to' },
  { rel: 'concepts/guardrails.md', title: 'Guardrails and effect classes', note: '', kind: 'explanation' },
  { rel: 'reference/steps.md', title: 'Step reference', note: '', kind: 'reference' },
  { rel: 'agents/connect-mcp.md', title: 'Automate with agents', note: '', kind: 'how-to' },
]

describe('groupDocsIndex', () => {
  it('buckets entries by kind, not by directory', () => {
    const groups = groupDocsIndex(INDEX)
    expect(groups.map((g) => g.id)).toEqual(['start-here', 'how-to', 'explanation', 'reference', 'agents'])
    expect(groups[1].entries.map((e) => e.rel)).toEqual(['reference/install-a-plugin.md'])
    expect(groups[3].entries.map((e) => e.rel)).toEqual(['reference/steps.md'])
  })

  it('keeps the fixed section order whatever order the entries arrive in', () => {
    const reordered = [INDEX[4], INDEX[5], INDEX[0], INDEX[3]]
    const groups = groupDocsIndex(reordered)
    expect(groups.map((g) => g.id)).toEqual(['start-here', 'explanation', 'reference', 'agents'])
  })

  it('keeps start-here pages together as the onboarding path whatever their kind', () => {
    const groups = groupDocsIndex(INDEX)
    expect(groups[0].entries.map((e) => e.rel)).toEqual(['start-here/what-is-mill.md', 'start-here/install.md'])
    expect(groups.find((g) => g.id === 'explanation')?.entries.map((e) => e.rel)).not.toContain('start-here/what-is-mill.md')
  })

  it('keeps agent how-to pages in their own section', () => {
    const groups = groupDocsIndex(INDEX)
    expect(groups.find((g) => g.id === 'agents')?.entries.map((e) => e.rel)).toEqual(['agents/connect-mcp.md'])
    expect(groups.find((g) => g.id === 'how-to')?.entries.map((e) => e.rel)).not.toContain('agents/connect-mcp.md')
  })

  it('resolves each section to its locale key', () => {
    const groups = groupDocsIndex(INDEX)
    expect(groups.map((g) => g.titleKey)).toEqual([
      'docs.sections.startHere',
      'docs.sections.howTo',
      'docs.sections.concepts',
      'docs.sections.reference',
      'docs.sections.agents',
    ])
  })

  it('appends a section for an unknown kind rather than dropping the page', () => {
    const groups = groupDocsIndex([{ rel: 'x/y.md', title: 'Y', note: '', kind: 'mystery' }])
    expect(groups.map((g) => g.id)).toEqual(['mystery'])
    expect(groups[0].titleKey).toBe('')
  })
})

describe('groupOf / groupTitleKey', () => {
  it('names the folder sections for start-here/ and agents/ pages and the kind otherwise', () => {
    expect(groupOf({ rel: 'start-here/install.md', kind: 'how-to' })).toBe('start-here')
    expect(groupOf({ rel: 'agents/diagrams.md', kind: 'how-to' })).toBe('agents')
    expect(groupOf({ rel: 'how-to/x.md', kind: 'how-to' })).toBe('how-to')
  })

  it('returns an empty string for a section outside the known set', () => {
    expect(groupTitleKey('unknown')).toBe('')
  })
})

describe('adjacentPages', () => {
  it('returns both neighbors for a page in the middle of the flat order', () => {
    expect(adjacentPages(INDEX, 'reference/install-a-plugin.md')).toEqual({
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
    expect(adjacentPages(INDEX, 'agents/connect-mcp.md')).toEqual({
      prev: INDEX[4],
      next: undefined,
    })
  })

  it('returns no neighbors for an unknown page', () => {
    expect(adjacentPages(INDEX, 'nonexistent.md')).toEqual({})
  })
})
