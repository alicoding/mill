import { describe, expect, it } from 'vitest'
import { kindLabelColor } from './atlasKindColor'

describe('kindLabelColor', () => {
  it('is stable for the same kind ID', () => {
    expect(kindLabelColor('atlas-kind-topic')).toBe(kindLabelColor('atlas-kind-topic'))
  })

  it('differs for at least some distinct kind IDs (not a constant fallback)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(kindLabelColor))
    expect(colors.size).toBeGreaterThan(1)
  })
})
