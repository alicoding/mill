import { describe, expect, it } from 'vitest'
import { previewReducer, previewedAppearance, type ThemePreview } from './appearancePreview'

describe('the theme preview state machine', () => {
  it('previews whatever the pointer or the arrow key lands on', () => {
    expect(previewReducer(null, { kind: 'point', family: 'light', scheme: 'p.sepia' }))
      .toEqual({ family: 'light', scheme: 'p.sepia' })
  })

  it('keeps the same object while the pointer stays on one item', () => {
    const first = previewReducer(null, { kind: 'point', family: 'dark', scheme: 'dark_dimmed' })
    expect(previewReducer(first, { kind: 'point', family: 'dark', scheme: 'dark_dimmed' })).toBe(first)
  })

  it.each(['leave', 'cancel', 'commit'] as const)('clears the preview on %s', (kind) => {
    const state: ThemePreview = { family: 'light', scheme: 'p.sepia' }
    expect(previewReducer(state, { kind })).toBeNull()
  })
})

describe('resolving a whole-window preview', () => {
  const committed = {
    mode: 'auto' as const,
    lightTheme: 'light_high_contrast',
    darkTheme: 'dark_high_contrast',
    resolvedMode: 'light' as const,
    scheme: 'light_high_contrast',
  }

  it('changes nothing when there is no preview', () => {
    expect(previewedAppearance(committed, null)).toBe(committed)
  })

  it('makes the preview family and exact scheme the active appearance', () => {
    expect(previewedAppearance(committed, { family: 'dark', scheme: 'p.slate' }))
      .toEqual({
        mode: 'dark',
        lightTheme: 'light_high_contrast',
        darkTheme: 'p.slate',
        resolvedMode: 'dark',
        scheme: 'p.slate',
      })
    expect(previewedAppearance(committed, { family: 'light', scheme: 'p.sepia' }))
      .toEqual({
        mode: 'light',
        lightTheme: 'p.sepia',
        darkTheme: 'dark_high_contrast',
        resolvedMode: 'light',
        scheme: 'p.sepia',
      })
  })
})
