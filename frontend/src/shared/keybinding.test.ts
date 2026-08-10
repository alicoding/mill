import { describe, expect, it } from 'vitest'
import { describeCombo, keyFromEventCode, modsFromEvent, reservedByMacOS } from './keybinding'

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

describe('reservedByMacOS', () => {
  it('rejects Spotlight (Cmd+Space)', () => {
    expect(reservedByMacOS(['cmd'], 'Space')).toBe('Spotlight')
  })

  it('rejects a screenshot combo (Cmd+Shift+4)', () => {
    expect(reservedByMacOS(['cmd', 'shift'], '4')).toBe('screenshot')
  })

  it('is mod-order-independent, same as the backend conflict check', () => {
    expect(reservedByMacOS(['shift', 'cmd'], '4')).toBe('screenshot')
  })

  it('allows an unrelated combo through', () => {
    expect(reservedByMacOS(['cmd', 'shift'], 'M')).toBeNull()
  })

  it('does not flag a reserved key when the modifier set differs', () => {
    // Cmd+Ctrl+Space is not Spotlight (Cmd+Space) or input-source
    // switching (Ctrl+Space) -- the mod SET must match exactly.
    expect(reservedByMacOS(['cmd', 'ctrl'], 'Space')).toBeNull()
  })
})

describe('describeCombo', () => {
  it('renders mods and key as a plain, capitalized, +-joined string', () => {
    expect(describeCombo(['cmd', 'shift'], 'W')).toBe('Cmd+Shift+W')
  })

  it('handles a single modifier', () => {
    expect(describeCombo(['cmd'], 'Space')).toBe('Cmd+Space')
  })
})
