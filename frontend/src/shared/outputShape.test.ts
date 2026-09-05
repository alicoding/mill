import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CAP_ROWS,
  capText,
  errorParts,
  findMatches,
  hasAnsi,
  inferShape,
  isRowShaped,
  outputText,
  parseJson,
  readStoredView,
  resolveShape,
  shapeFromMime,
  tableFrom,
  writeStoredView,
} from './outputShape'

describe('inferShape', () => {
  it('reads an object document as json', () => {
    expect(inferShape('{"a":1}')).toBe('json')
  })

  it('reads an array of objects as rows, not plain json', () => {
    expect(inferShape('[{"a":1},{"a":2}]')).toBe('rows')
  })

  it('reads an array of primitives as json', () => {
    expect(inferShape('[1,2,3]')).toBe('json')
  })

  it('reads a markup document as html', () => {
    expect(inferShape('<!doctype html><html><body>hi</body></html>')).toBe('html')
    expect(inferShape('<table><tr><td>1</td></tr></table>')).toBe('html')
  })

  it('does not mistake a brace-first document that fails to parse for json', () => {
    expect(inferShape('{ not json at all')).toBe('text')
  })

  it('reads anything else as text', () => {
    expect(inferShape('run finished in 4s')).toBe('text')
    expect(inferShape('')).toBe('text')
  })
})

describe('shapeFromMime', () => {
  it('drops parameters and matches the base type', () => {
    expect(shapeFromMime('application/json; charset=utf-8')).toBe('json')
  })

  it('accepts a +json suffix type', () => {
    expect(shapeFromMime('application/problem+json')).toBe('json')
  })

  it('maps markup, markdown, media and plain text', () => {
    expect(shapeFromMime('text/html')).toBe('html')
    expect(shapeFromMime('text/markdown')).toBe('markdown')
    expect(shapeFromMime('image/png')).toBe('binary')
    expect(shapeFromMime('text/csv')).toBe('text')
  })

  it('treats an unknown non-text type as binary and no type as no answer', () => {
    expect(shapeFromMime('application/octet-stream')).toBe('binary')
    expect(shapeFromMime(undefined)).toBeNull()
    expect(shapeFromMime('')).toBeNull()
  })
})

describe('resolveShape', () => {
  it('marks an inferred shape as detected and a declared one as not', () => {
    expect(resolveShape({ value: '{"a":1}' }).detected).toBe(true)
    expect(resolveShape({ value: '{"a":1}', shape: 'json' }).detected).toBe(false)
    expect(resolveShape({ value: 'plain', mime: 'text/plain' }).detected).toBe(false)
  })

  it('offers Table only when the value really is an array of objects', () => {
    expect(resolveShape({ value: [{ a: 1 }], shape: 'json' }).views).toEqual(['tree', 'table', 'raw'])
    expect(resolveShape({ value: { a: 1 }, shape: 'json' }).views).toEqual(['tree', 'raw'])
  })

  it('falls back from a declared rows shape that is not row shaped', () => {
    expect(resolveShape({ value: { a: 1 }, shape: 'rows' }).views).toEqual(['tree', 'raw'])
  })

  it('falls back to raw alone when a declared json value does not parse', () => {
    const resolved = resolveShape({ value: 'not json', shape: 'json' })
    expect(resolved.parseFailed).toBe(true)
    expect(resolved.views).toEqual(['raw'])
  })

  it('keeps a structured value as-is rather than round-tripping it through text', () => {
    const value = { a: [1, 2] }
    expect(resolveShape({ value }).parsed).toBe(value)
  })

  it('gives each remaining shape its own default view', () => {
    expect(resolveShape({ value: 'x', shape: 'text' }).views[0]).toBe('log')
    expect(resolveShape({ value: '<p>x</p>', shape: 'html' }).views[0]).toBe('rendered')
    expect(resolveShape({ value: '# x', shape: 'markdown' }).views[0]).toBe('rendered')
    expect(resolveShape({ value: 'boom', shape: 'error' }).views[0]).toBe('error')
    expect(resolveShape({ value: 'x', shape: 'binary' }).views[0]).toBe('media')
  })
})

describe('the render budget', () => {
  it('caps text and reports the full length', () => {
    const capped = capText('a'.repeat(20), 8)
    expect(capped.text).toHaveLength(8)
    expect(capped.truncated).toBe(true)
    expect(capped.total).toBe(20)
  })

  it('leaves text under the cap alone', () => {
    expect(capText('short', 100)).toEqual({ text: 'short', truncated: false, total: 5 })
  })

  it('caps rows and keeps the union of every row key as columns', () => {
    const rows = Array.from({ length: 600 }, (_, i) => (i === 0 ? { a: 1, b: 2 } : { a: i }))
    const table = tableFrom(rows)
    expect(table?.columns).toEqual(['a', 'b'])
    expect(table?.rows).toHaveLength(CAP_ROWS)
    expect(table?.total).toBe(600)
    expect(table?.truncated).toBe(true)
  })

  it('has no table for a value that is not row shaped', () => {
    expect(tableFrom({ a: 1 })).toBeNull()
    expect(tableFrom([])).toBeNull()
    expect(isRowShaped([1, 2])).toBe(false)
  })
})

describe('the session view choice', () => {
  // The suite runs without a DOM, so the one browser API this module
  // touches is stubbed here rather than pulling a whole environment in
  // for two assertions. (The module itself already degrades to "no
  // stored choice" when sessionStorage is missing or refuses.)
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('remembers a choice per site', () => {
    writeStoredView('run-step', 'raw')
    expect(readStoredView('run-step', ['tree', 'raw'])).toBe('raw')
    expect(readStoredView('other-site', ['tree', 'raw'])).toBeNull()
  })

  it('ignores a stored view the current shape cannot render', () => {
    writeStoredView('run-step', 'table')
    expect(readStoredView('run-step', ['log', 'raw'])).toBeNull()
  })
})

describe('supporting rules', () => {
  it('splits an error into its message and its trace', () => {
    expect(errorParts('boom\n at one\n at two')).toEqual({ message: 'boom', details: 'at one\n at two' })
    expect(errorParts('boom')).toEqual({ message: 'boom', details: '' })
  })

  it('finds every case-insensitive hit', () => {
    expect(findMatches('Alpha alpha ALPHA', 'alpha')).toEqual([0, 6, 12])
    expect(findMatches('nothing', '')).toEqual([])
  })

  it('recognises an ANSI sequence', () => {
    expect(hasAnsi('\u001b[31mred\u001b[0m')).toBe(true)
    expect(hasAnsi('plain')).toBe(false)
  })

  it('turns any value into text once', () => {
    expect(outputText(null)).toBe('')
    expect(outputText('already')).toBe('already')
    expect(outputText({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it('reports an unparseable document rather than throwing', () => {
    expect(parseJson('{').ok).toBe(false)
    expect(parseJson('   ').ok).toBe(false)
  })
})
