import { describe, expect, it } from 'vitest'
import { canvasNavigationProps, modeFromStored } from './canvasNavigation'

// The storage round-trip and live canvas behavior are proven at the
// e2e layer (canvas-navigation.spec.ts) -- unit tests here cover the
// pure halves only, the same split nodeComplexity.test.ts documents
// for its own localStorage-backed hook.
describe('canvasNavigation', () => {
  it('decodes stored values: only the exact mouse marker leaves the default', () => {
    expect(modeFromStored(null)).toBe('trackpad')
    expect(modeFromStored('trackpad')).toBe('trackpad')
    expect(modeFromStored('mouse')).toBe('mouse')
    expect(modeFromStored('garbage')).toBe('trackpad')
  })

  it('maps trackpad to scroll-pans and mouse to scroll-zooms, pinch always on', () => {
    expect(canvasNavigationProps('trackpad')).toEqual({
      panOnScroll: true,
      zoomOnScroll: false,
      zoomOnPinch: true,
      zoomActivationKeyCode: 'Meta',
    })
    expect(canvasNavigationProps('mouse')).toEqual({
      panOnScroll: false,
      zoomOnScroll: true,
      zoomOnPinch: true,
      zoomActivationKeyCode: 'Meta',
    })
  })
})
