import { afterEach, describe, expect, it, vi } from 'vitest'
import { newLocalID } from './localId'

// Regression: crypto.randomUUID exists only in secure contexts, and
// direct calls crashed the workflow editor on a remote plain-http
// instance -- the fallback must produce the same UUID shape from
// getRandomValues alone.
describe('newLocalID', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-uuid', getRandomValues: () => { throw new Error('unused') } })
    expect(newLocalID()).toBe('fixed-uuid')
  })

  it('falls back to a well-formed v4 UUID when randomUUID is absent (insecure context)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => { arr.fill(0xab); return arr },
    })
    const id = newLocalID()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('fallback ids differ across calls with real randomness', () => {
    expect(newLocalID()).not.toBe(newLocalID())
  })
})
