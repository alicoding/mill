import { describe, expect, it } from 'vitest'
import { nextColumnKey } from './projectionColumns'

describe('nextColumnKey', () => {
  it('slugs the label', () => {
    expect(nextColumnKey('Cert Expiry Date', [])).toBe('cert-expiry-date')
  })
  it('never collides with an existing key (ADR-0040 keys are immutable)', () => {
    expect(nextColumnKey('Status', ['status'])).toBe('status-2')
    expect(nextColumnKey('Status', ['status', 'status-2'])).toBe('status-3')
  })
  it('falls back for symbol-only labels', () => {
    expect(nextColumnKey('!!!', [])).toBe('column')
  })
})
