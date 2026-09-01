import { describe, expect, it } from 'vitest'
import { filterPaletteEntries } from './paletteFilter'

interface Entry {
  id: string
  searchText: string
}

function entry(id: string, searchText: string): Entry {
  return { id, searchText: searchText.toLowerCase() }
}

describe('filterPaletteEntries', () => {
  it('returns every entry, in original order, for an empty query', () => {
    const entries = [entry('a', 'alpha'), entry('b', 'beta')]
    expect(filterPaletteEntries(entries, '')).toEqual(entries)
  })

  it('returns every entry for a whitespace-only query', () => {
    const entries = [entry('a', 'alpha'), entry('b', 'beta')]
    expect(filterPaletteEntries(entries, '   ')).toEqual(entries)
  })

  it('excludes entries whose searchText does not contain the query', () => {
    const entries = [entry('a', 'next tab'), entry('b', 'previous tab')]
    expect(filterPaletteEntries(entries, 'zzz')).toEqual([])
  })

  it('matches case-insensitively', () => {
    const entries = [entry('a', 'go to workflows')]
    expect(filterPaletteEntries(entries, 'WORKFLOWS').map((e) => e.id)).toEqual(['a'])
  })

  it('ranks a prefix match before a mid-string match', () => {
    const entries = [entry('mid', 'previous tab'), entry('prefix', 'tab: close')]
    expect(filterPaletteEntries(entries, 'tab').map((e) => e.id)).toEqual(['prefix', 'mid'])
  })

  it('preserves relative order within each rank bucket', () => {
    const entries = [
      entry('run-a', 'run: alpha workflow'),
      entry('run-b', 'run: beta workflow'),
      entry('open-a', 'open: overrun workflow'),
    ]
    // "run" is a prefix match for run-a/run-b and a mid-string match
    // for open-a (inside "overrun") -- both prefix matches keep their
    // own relative order, and land ahead of the contains match.
    expect(filterPaletteEntries(entries, 'run').map((e) => e.id)).toEqual(['run-a', 'run-b', 'open-a'])
  })

  it('the teach-the-hotkeys case: "tab" surfaces the tab-navigation commands', () => {
    const entries = [
      entry('tab.next', 'next tab tab.next'),
      entry('tab.prev', 'previous tab tab.prev'),
      entry('view.composition', 'go to workflows view.composition'),
    ]
    const result = filterPaletteEntries(entries, 'tab')
    expect(result.map((e) => e.id)).toEqual(['tab.next', 'tab.prev'])
  })
})

// goal 0272: the fuzzy tier -- subsequence matching behind the
// substring tiers, never shadowing them.
describe('filterPaletteEntries fuzzy tier', () => {
  it('matches a word-initial abbreviation with no substring hit', () => {
    const entries = [entry('ows', 'open workflow settings'), entry('other', 'delete card')]
    expect(filterPaletteEntries(entries, 'ows').map((e) => e.id)).toEqual(['ows'])
  })

  it('ranks every substring hit ahead of every fuzzy hit', () => {
    const entries = [
      entry('fuzzy', 'open workflow settings'),
      entry('contains', 'browse rows'),
    ]
    // "ows" is a literal substring of "browse rOWS" and only a
    // subsequence of "Open Workflow Settings".
    expect(filterPaletteEntries(entries, 'ows').map((e) => e.id)).toEqual(['contains', 'fuzzy'])
  })

  it('rejects scattered-letter noise', () => {
    const entries = [entry('noise', 'zoom out to fit board contents')]
    // "wqx" appears nowhere as a subsequence worth surfacing.
    expect(filterPaletteEntries(entries, 'wqx')).toEqual([])
  })

  it('keeps original order between equal-scored fuzzy hits', () => {
    const entries = [
      entry('first', 'run alpha workflow now'),
      entry('second', 'run alpha workflow too'),
    ]
    const result = filterPaletteEntries(entries, 'raw').map((e) => e.id)
    expect(result).toEqual(['first', 'second'])
  })
})
