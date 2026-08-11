import { describe, expect, it } from 'vitest'
import { comboFromEvent, comboKey, describeCombo, formatCombo, keyFromEventCode, modsFromEvent, reservedByMacOS } from './keybinding'

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

  // docs/goals/0016-keymap-system.md's default keymap needs Tab
  // (tab.next/prev) and Comma (settings.open) captured by the same
  // recorder every other combo goes through -- the reserved-combo list
  // already anticipated Tab support arriving ("defensively, in case
  // keyFromEventCode ever grows Tab support").
  it('passes Tab through unchanged', () => {
    expect(keyFromEventCode('Tab')).toBe('Tab')
  })

  it('maps the Comma code to a literal comma', () => {
    expect(keyFromEventCode('Comma')).toBe(',')
  })

  // workflow.run's default moved off ⌘R to ⌘↩ (owner decision: ⌘R
  // stays the native browser/dev Reload) -- both the main Return key
  // and the numpad Enter key normalize to the same 'Enter' key, since
  // they're the same logical "run/submit" action.
  it('normalizes both Enter and NumpadEnter to the same key', () => {
    expect(keyFromEventCode('Enter')).toBe('Enter')
    expect(keyFromEventCode('NumpadEnter')).toBe('Enter')
  })
})

describe('comboFromEvent', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('requires Cmd or Ctrl -- never intercepts plain typing', () => {
    expect(comboFromEvent(event({ code: 'KeyW', shiftKey: true }))).toBeNull()
    expect(comboFromEvent(event({ code: 'KeyW' }))).toBeNull()
  })

  it('extracts mods+key for a real combo attempt', () => {
    expect(comboFromEvent(event({ code: 'KeyW', metaKey: true }))).toEqual({ mods: ['cmd'], key: 'W' })
  })

  it('returns null for an unsupported key even with a modifier held', () => {
    expect(comboFromEvent(event({ code: 'ArrowLeft', metaKey: true }))).toBeNull()
  })

  it('captures Ctrl+Tab, the keymap default for tab.next', () => {
    expect(comboFromEvent(event({ code: 'Tab', ctrlKey: true }))).toEqual({ mods: ['ctrl'], key: 'Tab' })
  })
})

describe('comboKey', () => {
  it('is mod-order-independent, mirroring the Go side\'s comboKey', () => {
    expect(comboKey(['cmd', 'shift'], 'S')).toBe(comboKey(['shift', 'cmd'], 'S'))
  })

  it('is case-independent on both mods and key', () => {
    expect(comboKey(['CMD'], 'w')).toBe(comboKey(['cmd'], 'W'))
  })

  it('distinguishes different combos', () => {
    expect(comboKey(['cmd'], 'W')).not.toBe(comboKey(['ctrl'], 'W'))
  })
})

describe('formatCombo', () => {
  it('renders mods as symbols, in the order given, then the uppercased key', () => {
    expect(formatCombo(['cmd', 'shift'], 'w')).toBe('⌘⇧W')
  })

  it('matches the keymap defaults from docs/goals/0016', () => {
    expect(formatCombo(['ctrl'], 'Tab')).toBe('⌃TAB')
    expect(formatCombo(['cmd'], ',')).toBe('⌘,')
  })

  // workflow.run's default (⌘↩) -- Enter gets Apple's own glyph
  // convention (Mail's "Send ⌘↩"), not the spelled-out 'ENTER' every
  // other multi-letter key falls back to.
  it('renders Enter as the ↩ glyph, not the spelled-out key name', () => {
    expect(formatCombo(['cmd'], 'Enter')).toBe('⌘↩')
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
