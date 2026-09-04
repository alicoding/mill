import { describe, expect, it } from 'vitest'
import { previewReducer, previewedSchemes, type ThemePreview } from './appearancePreview'

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

describe('applying a preview over the committed pair', () => {
  const committed = { lightTheme: 'light', darkTheme: 'dark' }

  it('changes nothing when there is no preview', () => {
    expect(previewedSchemes(committed, null)).toBe(committed)
  })

  it('replaces only the previewed family', () => {
    expect(previewedSchemes(committed, { family: 'light', scheme: 'p.sepia' }))
      .toEqual({ lightTheme: 'p.sepia', darkTheme: 'dark' })
    expect(previewedSchemes(committed, { family: 'dark', scheme: 'p.slate' }))
      .toEqual({ lightTheme: 'light', darkTheme: 'p.slate' })
  })
})
