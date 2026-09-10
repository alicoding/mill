import { describe, expect, it } from 'vitest'
import { paletteShortcutForEvent } from './paletteShortcut'

const advertised = [
  { mods: ['cmd'], key: 'K' },
  { mods: ['cmd'], key: '/' },
]

function event(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    isTrusted: true,
    repeat: false,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    code: '',
    ...overrides,
  } as KeyboardEvent
}

describe('paletteShortcutForEvent', () => {
  it('normalizes a trusted advertised physical keydown', () => {
    expect(paletteShortcutForEvent(event({ metaKey: true, code: 'Slash' }), advertised)).toEqual({ mods: ['cmd'], key: '/' })
  })

  it('refuses untrusted, composing and repeated keydowns', () => {
    expect(paletteShortcutForEvent(event({ isTrusted: false, metaKey: true, code: 'Slash' }), advertised)).toBeNull()
    expect(paletteShortcutForEvent(event({ isComposing: true, metaKey: true, code: 'Slash' }), advertised)).toBeNull()
    expect(paletteShortcutForEvent(event({ repeat: true, metaKey: true, code: 'Slash' }), advertised)).toBeNull()
  })

  it('leaves ordinary typing, copy, undo, navigation and unmatched plugin shortcuts alone', () => {
    for (const candidate of [
      event({ code: 'KeyA' }),
      event({ metaKey: true, code: 'KeyC' }),
      event({ metaKey: true, code: 'KeyZ' }),
      event({ code: 'ArrowLeft' }),
      event({ ctrlKey: true, code: 'KeyR' }),
    ]) expect(paletteShortcutForEvent(candidate, advertised)).toBeNull()
  })

  it('refuses a binding the host has stopped advertising', () => {
    expect(paletteShortcutForEvent(event({ metaKey: true, code: 'KeyK' }), [{ mods: ['cmd'], key: 'P' }])).toBeNull()
  })
})
