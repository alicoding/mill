import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIST_VIEW_STATE, LIST_PAGE_SIZE, availableSorts, clampPage, listCountLabel, listStateKey,
  pageCountFor, pageItems, readListState, sortItems, splitExamples, writeListState,
  type ListStateStorage,
} from './listStandard'

const item = (label: string, extra: Partial<{ updatedAt: string; createdAt: string; builtIn: boolean }> = {}) =>
  ({ label, ...extra })

describe('sortItems', () => {
  it('orders newest-updated-first by default', () => {
    const items = [
      item('old', { updatedAt: '2026-01-01T00:00:00Z' }),
      item('new', { updatedAt: '2026-06-01T00:00:00Z' }),
      item('mid', { updatedAt: '2026-03-01T00:00:00Z' }),
    ]
    expect(sortItems(items, 'updated').map((i) => i.label)).toEqual(['new', 'mid', 'old'])
  })

  it('orders A-Z by label, case-insensitively', () => {
    const items = [item('zebra'), item('Apple'), item('mango')]
    expect(sortItems(items, 'name').map((i) => i.label)).toEqual(['Apple', 'mango', 'zebra'])
  })

  it('orders newest-created-first', () => {
    const items = [
      item('first', { createdAt: '2026-01-01T00:00:00Z' }),
      item('second', { createdAt: '2026-05-01T00:00:00Z' }),
    ]
    expect(sortItems(items, 'created').map((i) => i.label)).toEqual(['second', 'first'])
  })

  it('preserves incoming order when no item carries the timestamp it sorts on', () => {
    const items = [item('b'), item('a'), item('c')]
    expect(sortItems(items, 'updated').map((i) => i.label)).toEqual(['b', 'a', 'c'])
    expect(sortItems(items, 'created').map((i) => i.label)).toEqual(['b', 'a', 'c'])
  })

  it('does not mutate its input', () => {
    const items = [item('b'), item('a')]
    sortItems(items, 'name')
    expect(items.map((i) => i.label)).toEqual(['b', 'a'])
  })
})

describe('availableSorts', () => {
  it('offers an ordering only when at least one item carries the timestamp it reads', () => {
    expect(availableSorts([{ updatedAt: 'u', createdAt: '2026-01-01T00:00:00Z' }])).toEqual(['updated', 'name', 'created'])
    expect(availableSorts([{ updatedAt: 'u' }])).toEqual(['updated', 'name'])
    expect(availableSorts([{ updatedAt: 'u', createdAt: '' }])).toEqual(['updated', 'name'])
    expect(availableSorts([{}])).toEqual(['name'])
    expect(availableSorts([])).toEqual(['name'])
  })
})

describe('splitExamples', () => {
  it('separates seeded examples from the user own items, keeping each side in order', () => {
    const items = [item('mine'), item('seeded', { builtIn: true }), item('also mine'), item('seeded 2', { builtIn: true })]
    const { own, examples } = splitExamples(items)
    expect(own.map((i) => i.label)).toEqual(['mine', 'also mine'])
    expect(examples.map((i) => i.label)).toEqual(['seeded', 'seeded 2'])
  })

  it('treats a missing flag as the user own item', () => {
    expect(splitExamples([{ builtIn: false }, {}]).examples).toEqual([])
  })
})

describe('pageItems', () => {
  const items = Array.from({ length: 26 }, (_, i) => i + 1)

  it('paginates at the standard page size', () => {
    expect(LIST_PAGE_SIZE).toBe(25)
    expect(pageItems(items, 1)).toHaveLength(25)
    expect(pageItems(items, 2)).toEqual([26])
  })

  it('clamps a page past the end rather than rendering nothing', () => {
    expect(pageItems(items, 99)).toEqual([26])
  })

  it('never reports zero pages', () => {
    expect(pageCountFor(0)).toBe(1)
    expect(pageCountFor(25)).toBe(1)
    expect(pageCountFor(26)).toBe(2)
    expect(clampPage(0, 3)).toBe(1)
    expect(clampPage(Number.NaN, 3)).toBe(1)
    expect(clampPage(9, 3)).toBe(3)
  })
})

describe('listCountLabel', () => {
  it('shows the bare total when nothing narrows the list', () => {
    expect(listCountLabel({ total: 40, shown: 40 })).toEqual({ key: 'list.countTotal', params: { total: 40 } })
  })

  it('shows shown-of-total when a search or filter narrows it', () => {
    expect(listCountLabel({ total: 40, shown: 12 })).toEqual({ key: 'list.countNarrowed', params: { shown: 12, total: 40 } })
  })

  it('shows the page range when the list is paged, even if also narrowed', () => {
    expect(listCountLabel({ total: 40, shown: 30, from: 1, to: 25 }))
      .toEqual({ key: 'list.countRange', params: { from: 1, to: 25, total: 40 } })
  })
})

describe('list view state', () => {
  function memoryStorage(): ListStateStorage & { data: Map<string, string> } {
    const data = new Map<string, string>()
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => { data.set(k, v) },
    }
  }

  const throwingStorage: ListStateStorage = {
    getItem: () => { throw new Error('storage blocked') },
    setItem: () => { throw new Error('storage blocked') },
  }

  it('keys state per list id', () => {
    expect(listStateKey('configure.requests')).toBe('mill.list.configure.requests')
  })

  it('round-trips sort, page and the examples disclosure', () => {
    const storage = memoryStorage()
    writeListState('workflows', { sort: 'name', page: 3, examplesExpanded: true }, storage)
    expect(readListState('workflows', storage)).toEqual({ sort: 'name', page: 3, examplesExpanded: true })
  })

  it('falls back to the defaults for a missing, corrupt or wrongly-typed record', () => {
    const storage = memoryStorage()
    expect(readListState('workflows', storage)).toEqual(DEFAULT_LIST_VIEW_STATE)
    storage.data.set(listStateKey('workflows'), 'not json')
    expect(readListState('workflows', storage)).toEqual(DEFAULT_LIST_VIEW_STATE)
    storage.data.set(listStateKey('workflows'), '"a string"')
    expect(readListState('workflows', storage)).toEqual(DEFAULT_LIST_VIEW_STATE)
    storage.data.set(listStateKey('workflows'), JSON.stringify({ sort: 'bogus', page: 'x', examplesExpanded: 'yes' }))
    expect(readListState('workflows', storage)).toEqual({ sort: 'updated', page: 1, examplesExpanded: undefined })
  })

  it('costs the memory, never the list, when storage throws', () => {
    expect(() => writeListState('workflows', { sort: 'name', page: 2 }, throwingStorage)).not.toThrow()
    expect(readListState('workflows', throwingStorage)).toEqual(DEFAULT_LIST_VIEW_STATE)
  })

  it('is inert when there is no storage at all', () => {
    expect(readListState('workflows', null)).toEqual(DEFAULT_LIST_VIEW_STATE)
    expect(() => writeListState('workflows', { sort: 'name', page: 2 }, null)).not.toThrow()
  })
})
