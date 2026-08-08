import { describe, expect, it } from 'vitest'
import { keyFromEventCode, modsFromEvent } from './keybinding'

describe('keyFromEventCode', () => {
  it('strips the Key prefix from letter codes', () => {
    expect(keyFromEventCode('KeyM')).toBe('M')
  })

  it('strips the Digit prefix from number codes', () => {
    expect(keyFromEventCode('Digit1')).toBe('1')
  })

  it('passes Space through unchanged', () => {
    expect(keyFromEventCode('Space')).toBe('Space')
  })

  it('returns null for a modifier-only or unsupported code', () => {
    expect(keyFromEventCode('ShiftLeft')).toBeNull()
    expect(keyFromEventCode('ControlLeft')).toBeNull()
  })
})

describe('modsFromEvent', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('returns an empty array when no modifiers are held', () => {
    expect(modsFromEvent(event({}))).toEqual([])
  })

  it('maps each modifier key to its lowercase name', () => {
    expect(
      modsFromEvent(event({ metaKey: true, ctrlKey: true, shiftKey: true, altKey: true })),
    ).toEqual(['cmd', 'ctrl', 'shift', 'option'])
  })

  it('includes only the modifiers actually held, in a fixed order', () => {
    expect(modsFromEvent(event({ shiftKey: true, metaKey: true }))).toEqual(['cmd', 'shift'])
  })
})
