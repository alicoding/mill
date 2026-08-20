import { describe, expect, it } from 'vitest'
import { normalizeExternalURL } from './externalUrl'

describe('normalizeExternalURL', () => {
  it('adds https:// to scheme-less values', () => {
    expect(normalizeExternalURL('alicoding.com')).toBe('https://alicoding.com')
    expect(normalizeExternalURL('  example.org/x ')).toBe('https://example.org/x')
  })
  it('leaves schemed values and empties alone', () => {
    expect(normalizeExternalURL('https://a.b')).toBe('https://a.b')
    expect(normalizeExternalURL('mailto:x@y.z')).toBe('mailto:x@y.z')
    expect(normalizeExternalURL('')).toBe('')
  })
})
