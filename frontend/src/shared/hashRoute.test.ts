import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineHashRoute } from './hashRoute'

// The one route contract both Settings and Configure instantiate
// (goal 0116): decode / encode, and the per-device memory that must
// survive a browser refusing storage.
type Pane = 'alpha' | 'beta'
const route = defineHashRoute<Pane>({
  prefix: '#/x',
  storageKey: 'test-pane',
  fallback: 'alpha',
  resolve: (v) => (v === 'beta' ? 'beta' : 'alpha'),
})

afterEach(() => vi.unstubAllGlobals())

describe('defineHashRoute', () => {
  it('decodes the prefix, a pane under it, and nothing else', () => {
    expect(route.fromHash('#/x')).toBe('alpha')
    expect(route.fromHash('#/x/beta')).toBe('beta')
    expect(route.fromHash('#/x/nonsense')).toBe('alpha')
    expect(route.fromHash('#/xy')).toBeNull()
    expect(route.fromHash('#/y/beta')).toBeNull()
    expect(route.isHash('#/x/beta')).toBe(true)
    expect(route.hashFor('beta')).toBe('#/x/beta')
  })

  it('remembers the last pane per device and falls back when storage refuses', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    })
    expect(route.readLast()).toBe('alpha')
    route.remember('beta')
    expect(route.readLast()).toBe('beta')

    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    })
    expect(() => route.remember('beta')).not.toThrow()
    expect(route.readLast()).toBe('alpha')
  })
})
