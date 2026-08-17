import { describe, expect, it } from 'vitest'
import { linkKindTintToken } from './atlasLinkKindColor'

describe('linkKindTintToken', () => {
  it('is stable for the same link kind ID', () => {
    expect(linkKindTintToken('atlas-linkkind-relates-to')).toBe(linkKindTintToken('atlas-linkkind-relates-to'))
  })

  it('differs for at least some distinct link kind IDs (not a constant fallback)', () => {
    const tokens = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(linkKindTintToken))
    expect(tokens.size).toBeGreaterThan(1)
  })

  it('returns a CSS custom property name, never a raw color value', () => {
    expect(linkKindTintToken('atlas-linkkind-relates-to').startsWith('--')).toBe(true)
  })
})
