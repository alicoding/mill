import { describe, expect, it } from 'vitest'
import { dispatchCommandForEvent, findCommand } from './commands'

// docs/goals/BACKLOG.md Standing #6 (⌘?/⌘/ palette aliases): a
// Command's optional extraBindings (shared/commands.ts) must dispatch
// the SAME command as its primary defaultBinding, and an override on
// the primary must never affect extras (they're deliberately not
// override-checked -- see Command.extraBindings' own doc comment).
describe('dispatchCommandForEvent with extraBindings', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('palette.open has the two documented extra bindings registered', () => {
    const command = findCommand('palette.open')
    expect(command?.extraBindings).toEqual([
      { mods: ['cmd'], key: '/' },
      { mods: ['cmd', 'shift'], key: '/' },
    ])
  })

  it('Cmd+K (the primary default) still opens the palette', () => {
    const ran = dispatchCommandForEvent(event({ code: 'KeyK', metaKey: true }), {})
    expect(ran).toBe(true)
  })

  it('Cmd+/ (an extra binding) also dispatches palette.open', () => {
    const ran = dispatchCommandForEvent(event({ code: 'Slash', metaKey: true }), {})
    expect(ran).toBe(true)
  })

  it('Cmd+Shift+/ (the ⌘? glyph, the second extra binding) also dispatches palette.open', () => {
    const ran = dispatchCommandForEvent(event({ code: 'Slash', metaKey: true, shiftKey: true }), {})
    expect(ran).toBe(true)
  })

  it('Ctrl+/ is not bound to anything -- extras match on their exact mods, not just the "/" key', () => {
    const ran = dispatchCommandForEvent(event({ code: 'Slash', ctrlKey: true }), {})
    expect(ran).toBe(false)
  })

  it('an override on the primary binding does not disable the extras', () => {
    // palette.open rebound to Cmd+P in Settings -- Cmd+K itself no
    // longer runs it, but the two extras (never override-checked, per
    // Command.extraBindings' own doc comment) still do.
    const overrides = { 'palette.open': { mods: ['cmd'], key: 'P' } }
    expect(dispatchCommandForEvent(event({ code: 'KeyK', metaKey: true }), overrides)).toBe(false)
    expect(dispatchCommandForEvent(event({ code: 'Slash', metaKey: true }), overrides)).toBe(true)
    expect(dispatchCommandForEvent(event({ code: 'KeyP', metaKey: true }), overrides)).toBe(true)
  })

  it('tab.next/tab.prev carry the browser-convention bracket aliases', () => {
    expect(findCommand('tab.next')?.extraBindings).toEqual([{ mods: ['cmd', 'shift'], key: ']' }])
    expect(findCommand('tab.prev')?.extraBindings).toEqual([{ mods: ['cmd', 'shift'], key: '[' }])
  })

  it('Cmd+Shift+] and Cmd+Shift+[ dispatch (tab cycling via the aliases)', () => {
    expect(dispatchCommandForEvent(event({ code: 'BracketRight', metaKey: true, shiftKey: true }), {})).toBe(true)
    expect(dispatchCommandForEvent(event({ code: 'BracketLeft', metaKey: true, shiftKey: true }), {})).toBe(true)
  })

  it('bare Cmd+] stays unbound -- the aliases require Shift, exact-mods matching', () => {
    expect(dispatchCommandForEvent(event({ code: 'BracketRight', metaKey: true }), {})).toBe(false)
    expect(dispatchCommandForEvent(event({ code: 'BracketLeft', metaKey: true }), {})).toBe(false)
  })

  it('a command with no extraBindings is unaffected (backward-compatible)', () => {
    // tab.close has no extras -- only its own Cmd+W default dispatches
    // it, same behavior as before this feature existed.
    expect(dispatchCommandForEvent(event({ code: 'KeyW', metaKey: true }), {})).toBe(true)
    expect(dispatchCommandForEvent(event({ code: 'Slash', metaKey: true, ctrlKey: true }), {})).toBe(false)
  })
})
