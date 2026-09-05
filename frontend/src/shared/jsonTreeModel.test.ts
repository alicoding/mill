import { describe, expect, it } from 'vitest'
import {
  ROOT_PATH,
  allContainerPaths,
  childrenOf,
  containerSummary,
  joinPath,
  kindOf,
  matchCount,
  nodeCopyText,
  nodeMatches,
  nodesByPath,
  pathsToDepth,
  pathsToExpandFor,
  primitiveLabel,
  subtreeMatches,
  valueKind,
} from './jsonTreeModel'

describe('paths', () => {
  it('uses dotted access for an identifier key and brackets for anything else', () => {
    expect(joinPath('$', 'name', false)).toBe('$.name')
    expect(joinPath('$', 'content-type', false)).toBe('$["content-type"]')
    expect(joinPath('$', '0', true)).toBe('$[0]')
  })

  it('builds a full path down a nested value', () => {
    const [items] = childrenOf({ items: [{ 'x-id': 1 }] }, ROOT_PATH)
    const [first] = childrenOf(items.value, items.path)
    const [field] = childrenOf(first.value, first.path)
    expect(field.path).toBe('$.items[0]["x-id"]')
  })
})

describe('rows', () => {
  it('separates containers from primitives', () => {
    expect(kindOf([])).toBe('array')
    expect(kindOf({})).toBe('object')
    expect(kindOf(null)).toBe('primitive')
    expect(kindOf('x')).toBe('primitive')
  })

  it('shows a collapsed container as its count, in its own brackets', () => {
    const [arr, obj] = childrenOf({ a: [1, 2, 3], b: { x: 1 } }, ROOT_PATH)
    expect(containerSummary(arr)).toBe('[3]')
    expect(containerSummary(obj)).toBe('{1}')
  })

  it('keeps a string quoted so an empty string stays visible', () => {
    expect(primitiveLabel('')).toBe('""')
    expect(primitiveLabel('7')).toBe('"7"')
    expect(primitiveLabel(7)).toBe('7')
    expect(primitiveLabel(null)).toBe('null')
    expect(primitiveLabel(false)).toBe('false')
  })

  it('copies a primitive bare and a container as JSON', () => {
    const [text, obj] = childrenOf({ a: 'hello', b: { x: 1 } }, ROOT_PATH)
    expect(nodeCopyText(text)).toBe('hello')
    expect(nodeCopyText(obj)).toBe('{\n  "x": 1\n}')
  })
})

describe('expansion', () => {
  it('lists every container path for Expand all', () => {
    expect(allContainerPaths({ a: { b: { c: 1 } }, d: 2 })).toEqual(['$.a', '$.a.b'])
  })

  it('opens every ancestor of a find hit, however deep', () => {
    const value = { one: { two: { three: { needle: 'found' } } } }
    expect([...pathsToExpandFor(value, 'needle')].sort()).toEqual(['$.one', '$.one.two', '$.one.two.three'])
  })

  it('matches on a primitive value, not only on a key', () => {
    expect([...pathsToExpandFor({ outer: { status: 'failed' } }, 'failed')]).toEqual(['$.outer'])
  })

  it('opens nothing for an empty query or a miss', () => {
    expect(pathsToExpandFor({ a: { b: 1 } }, '').size).toBe(0)
    expect(pathsToExpandFor({ a: { b: 1 } }, 'zzz').size).toBe(0)
  })
})

// goal 0269's additions: the root-less path form the board face copies,
// the arrival depth, the find summary's own number, the row lookup a
// focused-row command resolves through, and the empty-container reading
// that must never grow a chevron.
describe('the board face\'s own reading (goal 0269)', () => {
  it('drops the root token entirely when there is no root to name', () => {
    expect(joinPath('', 'workstreams', false)).toBe('workstreams')
    expect(joinPath('', 'odd key', false)).toBe('["odd key"]')
    expect(joinPath('', '0', true)).toBe('[0]')
    const [ws] = childrenOf({ workstreams: [{ owner: 'Priya' }] }, '')
    const [first] = childrenOf(ws.value, ws.path)
    const [owner] = childrenOf(first.value, first.path)
    expect(owner.path).toBe('workstreams[0].owner')
  })

  it('reads an empty container as its bare brackets, with no count', () => {
    const [arr, obj] = childrenOf({ a: [], b: {} }, '')
    expect(containerSummary(arr)).toBe('[]')
    expect(containerSummary(obj)).toBe('{}')
  })

  it('opens containers to the requested depth and no deeper', () => {
    const value = { a: { b: { c: 1 } }, d: [{ e: 1 }], f: 2, g: {} }
    expect(pathsToDepth(value, 1, '')).toEqual(['a', 'd'])
    expect(pathsToDepth(value, 2, '')).toEqual(['a', 'a.b', 'd', 'd[0]'])
  })

  it('counts every matching row, including rows inside collapsed containers', () => {
    const value = { owner: 'Priya', team: { owner: 'Sam' }, note: 'owner of record' }
    expect(matchCount(value, 'owner', '')).toBe(3)
    expect(matchCount(value, 'OWNER', '')).toBe(3)
    expect(matchCount(value, 'nothing', '')).toBe(0)
    expect(matchCount(value, '', '')).toBe(0)
  })

  it('resolves every row back from its own path', () => {
    const value = { workstreams: [{ owner: 'Priya' }] }
    const rows = nodesByPath(value, '')
    expect([...rows.keys()]).toEqual(['workstreams', 'workstreams[0]', 'workstreams[0].owner'])
    expect(rows.get('workstreams[0].owner')?.value).toBe('Priya')
  })

  it('names each primitive kind so the row can paint it', () => {
    expect(valueKind('x')).toBe('string')
    expect(valueKind(7)).toBe('number')
    expect(valueKind(true)).toBe('boolean')
    expect(valueKind(null)).toBe('null')
    expect(valueKind([])).toBe('array')
    expect(valueKind({})).toBe('object')
  })
})

describe('filtering rows (goal 0269)', () => {
  const value = { owner: 'Priya', team: { lead: 'Sam', size: 3 }, note: 'unrelated' }

  it('answers whether anything below a row matches, so the row can be kept', () => {
    const [, team] = childrenOf(value, '')
    expect(subtreeMatches(team, 'lead')).toBe(true)
    expect(subtreeMatches(team, 'Sam')).toBe(true)
    expect(subtreeMatches(team, 'owner')).toBe(false)
  })

  it('matches keys and primitive values alike, case-insensitively', () => {
    const [owner, , note] = childrenOf(value, '')
    expect(nodeMatches(owner, 'OWNER')).toBe(true)
    expect(nodeMatches(owner, 'priya')).toBe(true)
    expect(nodeMatches(note, 'owner')).toBe(false)
  })
})
