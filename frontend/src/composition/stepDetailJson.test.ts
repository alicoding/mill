import { describe, expect, it } from 'vitest'
import { isJsonLike, formatJson } from './stepDetailJson'

describe('isJsonLike', () => {
  it('is false for plain text', () => {
    expect(isJsonLike('hello world')).toBe(false)
  })

  it('is false for an empty string', () => {
    expect(isJsonLike('')).toBe(false)
  })

  it('is true for a JSON object', () => {
    expect(isJsonLike('{"a": 1}')).toBe(true)
  })

  it('is true for a JSON array', () => {
    expect(isJsonLike('[1, 2, 3]')).toBe(true)
  })

  it('is true for a JSON object with surrounding whitespace', () => {
    expect(isJsonLike('  {"a": 1}\n')).toBe(true)
  })

  it('is false for malformed JSON that starts with a brace', () => {
    expect(isJsonLike('{not valid json')).toBe(false)
  })

  it('is false for a bare JSON string or number (no structural gain from a JSON view)', () => {
    expect(isJsonLike('"just a string"')).toBe(false)
    expect(isJsonLike('42')).toBe(false)
  })
})

describe('formatJson', () => {
  it('pretty-prints a compact JSON object', () => {
    expect(formatJson('{"a":1,"b":2}')).toBe('{\n  "a": 1,\n  "b": 2\n}')
  })

  it('returns the raw string unchanged on a parse failure', () => {
    expect(formatJson('not json')).toBe('not json')
  })
})
