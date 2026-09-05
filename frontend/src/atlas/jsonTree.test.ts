import { describe, expect, it } from 'vitest'
import { isJsonPath, isParseError, jsonFormatFor, parseJsonDocument } from './jsonTree'

// The parse half of the board's json object (goal 0269). The tree SHAPE
// it feeds (paths, counts, filtering) is shared/jsonTreeModel.test.ts's
// subject; this file owns only "these bytes, in this format, become
// this value -- or this error, at this place".

describe('isJsonPath / jsonFormatFor', () => {
  it('claims .json, .yaml and .yml, case-insensitively, and nothing else', () => {
    expect(isJsonPath('/tmp/engagement.json')).toBe(true)
    expect(isJsonPath('/tmp/engagement.YAML')).toBe(true)
    expect(isJsonPath('/tmp/engagement.yml')).toBe(true)
    expect(isJsonPath('/tmp/engagement.csv')).toBe(false)
    expect(isJsonPath('/tmp/engagement')).toBe(false)
    // A dot in a DIRECTORY name is not the file's extension.
    expect(isJsonPath('/tmp/v1.2/engagement')).toBe(false)
  })

  it('routes only the yaml extensions to the yaml parser', () => {
    expect(jsonFormatFor('/tmp/a.json')).toBe('json')
    expect(jsonFormatFor('/tmp/a.yaml')).toBe('yaml')
    expect(jsonFormatFor('/tmp/a.yml')).toBe('yaml')
  })
})

describe('parseJsonDocument', () => {
  it('reads JSON', async () => {
    const result = await parseJsonDocument('{"a": 1, "b": [true, null]}', 'json')
    expect(result).toEqual({ value: { a: 1, b: [true, null] } })
  })

  it('reads YAML, resolving anchors and dropping comments', async () => {
    const text = '# a comment\ndefaults: &d\n  status: open\ncopy: *d\n'
    const result = await parseJsonDocument(text, 'yaml')
    expect(result).toEqual({ value: { defaults: { status: 'open' }, copy: { status: 'open' } } })
  })

  it('merges a `<<` key into its own document rather than showing it as a member', async () => {
    const text = 'defaults: &d\n  status: open\nitem:\n  <<: *d\n  name: One\n'
    const result = await parseJsonDocument(text, 'yaml')
    expect(result).toEqual({ value: { defaults: { status: 'open' }, item: { status: 'open', name: 'One' } } })
  })

  it('names each document of a multi-document YAML file', async () => {
    const result = await parseJsonDocument('a: 1\n---\nb: 2\n', 'yaml')
    expect(result).toEqual({ value: { 'Document 1': { a: 1 }, 'Document 2': { b: 2 } } })
  })

  it('reads a single-document YAML file as its own root, never wrapped', async () => {
    const result = await parseJsonDocument('a: 1\n', 'yaml')
    expect(result).toEqual({ value: { a: 1 } })
  })

  it('reports a JSON syntax error with the line and column it failed at', async () => {
    const result = await parseJsonDocument('{\n  "a": 1,\n  "b" 2\n}\n', 'json')
    expect(isParseError(result)).toBe(true)
    if (!isParseError(result)) return
    expect(result.error.line).toBe(3)
    expect(result.error.column).toBeGreaterThan(0)
    expect(result.error.message).not.toContain('\n')
    // The place is stated once, by line/column -- the parser's own
    // "in JSON at position N (line L column C)" tail is dropped.
    expect(result.error.message).toBe("Expected ':' after property name")
  })

  it('reports a YAML syntax error with the line and column the parser names', async () => {
    const result = await parseJsonDocument('a: [1, 2\nb: 3\n', 'yaml')
    expect(isParseError(result)).toBe(true)
    if (!isParseError(result)) return
    expect(result.error.line).toBe(2)
    expect(result.error.column).toBe(1)
    // The parser's own excerpt repeats the file; only its sentence
    // reaches the face.
    expect(result.error.message).not.toContain('\n')
  })

  it('reads an empty YAML file as an empty document rather than an error', async () => {
    expect(await parseJsonDocument('', 'yaml')).toEqual({ value: null })
  })
})
