import { describe, expect, it } from 'vitest'
import { kindColorTokens, kindLabelColor } from './atlasKindColor'

describe('kindLabelColor', () => {
  it('is stable for the same kind ID', () => {
    expect(kindLabelColor('atlas-kind-topic')).toBe(kindLabelColor('atlas-kind-topic'))
  })

  it('differs for at least some distinct kind IDs (not a constant fallback)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(kindLabelColor))
    expect(colors.size).toBeGreaterThan(1)
  })
})

describe('kindColorTokens', () => {
  it('is stable for the same kind ID', () => {
    expect(kindColorTokens('atlas-kind-topic')).toEqual(kindColorTokens('atlas-kind-topic'))
  })

  it('returns a CSS custom property name for every field, never a raw color value', () => {
    const tokens = kindColorTokens('atlas-kind-topic')
    for (const value of Object.values(tokens)) {
      expect(value.startsWith('--')).toBe(true)
    }
  })
})
