import { describe, expect, it } from 'vitest'
import {
  ROOT_PATH,
  allContainerPaths,
  childrenOf,
  containerSummary,
  joinPath,
  kindOf,
  nodeCopyText,
  pathsToExpandFor,
  primitiveLabel,
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
