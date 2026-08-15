import { describe, expect, it } from 'vitest'
import { Complexity } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { filterByComplexity } from './nodeComplexity'

// useShowAdvancedSteps itself (the localStorage-backed persisted
// toggle) isn't unit-tested here -- this repo's frontend toolchain has
// no @testing-library/react installed (HotkeyHint.tsx's own note), so
// a hook that touches both React state and the browser-only
// localStorage global is proven at the e2e layer instead
// (node-palette.spec.ts), matching testing.md's "interaction e2e" tier
// for presentation state a pure-function test can't express. This file
// covers filterByComplexity, the actual filter logic, which has no
// React/DOM dependency at all.
describe('filterByComplexity', () => {
  const basicStep = { Complexity: Complexity.ComplexityBasic }
  const advancedStep = { Complexity: Complexity.ComplexityAdvanced }

  it('passes every step through unchanged when showAdvanced is true', () => {
    expect(filterByComplexity([basicStep, advancedStep], true)).toEqual([basicStep, advancedStep])
  })

  it('drops advanced steps and keeps basic ones when showAdvanced is false', () => {
    expect(filterByComplexity([basicStep, advancedStep], false)).toEqual([basicStep])
  })

  it('returns an empty list unchanged either way', () => {
    expect(filterByComplexity([], true)).toEqual([])
    expect(filterByComplexity([], false)).toEqual([])
  })
})
