import { describe, expect, it } from 'vitest'
import type { BrowseEntry } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { filterBrowseEntries } from './extensionsBrowseFilter'

function entry(id: string, name: string, kinds: string[] = []): BrowseEntry {
  return { Marketplace: 'm1', Owner: 'o', ID: id, Name: name, Description: '', Version: '1.0.0', Author: 'a', Kinds: kinds, Installed: false, Tier: 'unverified' } as BrowseEntry
}

describe('filterBrowseEntries', () => {
  it('returns every entry, in original order, for an empty query', () => {
    const entries = [entry('a', 'Alpha'), entry('b', 'Beta')]
    expect(filterBrowseEntries(entries, '', [])).toEqual(entries)
  })

  it('matches a plain substring against the name', () => {
    const entries = [entry('a', 'Markdown Converter')]
    expect(filterBrowseEntries(entries, 'convert', [])).toEqual(entries)
  })

  it('matches a typo\'d query a substring test would miss', () => {
    const entries = [entry('a', 'Markdown Converter')]
    expect('markdown converter'.includes('convrter')).toBe(false)
    expect(filterBrowseEntries(entries, 'convrter', [])).toEqual(entries)
  })

  it('still requires the kind filter, independent of the query match', () => {
    const entries = [entry('a', 'Markdown Converter', ['diagram'])]
    expect(filterBrowseEntries(entries, 'markdown', ['document'])).toEqual([])
  })
})
