import { describe, expect, it } from 'vitest'
import { dispatchCommandForEvent, findCommand, surfacesIntersect } from './commands'
import { useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'

// docs/goals/BACKLOG.md Standing #6 (⌘?/⌘/ palette aliases): a
// Command's optional extraBindings (shared/commands.ts) must dispatch
// the SAME command as its primary defaultBinding, and an override on
// the primary must never affect extras (they're deliberately not
// override-checked -- see Command.extraBindings' own doc comment).
describe('dispatchCommandForEvent with extraBindings', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('palette.open carries only its ⌘/ extra binding -- ⌘⇧/ moved to help.shortcuts (goal 0071)', () => {
    const command = findCommand('palette.open')
    expect(command?.extraBindings).toEqual([{ mods: ['cmd'], key: '/' }])
  })

  it('help.shortcuts carries the ⌘⇧/ (⌘?) alias, unbound by default', () => {
    const command = findCommand('help.shortcuts')
    expect(command?.defaultBinding).toBeNull()
    expect(command?.extraBindings).toEqual([{ mods: ['cmd', 'shift'], key: '/' }])
  })

  it('Cmd+K (the primary default) still opens the palette', () => {
    const ran = dispatchCommandForEvent(event({ code: 'KeyK', metaKey: true }), {})
    expect(ran).toBe(true)
  })

  it('Cmd+/ (an extra binding) also dispatches palette.open', () => {
    const ran = dispatchCommandForEvent(event({ code: 'Slash', metaKey: true }), {})
    expect(ran).toBe(true)
  })

  it('Cmd+Shift+/ (the ⌘? glyph) now dispatches help.shortcuts, not the palette', () => {
    useAppStore.getState().closePalette()
    useUISignalStore.getState().closeHelp()
    const ran = dispatchCommandForEvent(event({ code: 'Slash', metaKey: true, shiftKey: true }), {})
    expect(ran).toBe(true)
    expect(useUISignalStore.getState().helpOpen).toBe(true)
    expect(useAppStore.getState().paletteOpen).toBe(false)
    useUISignalStore.getState().closeHelp()
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

// Goal 0071's ⌘K reconciliation: atlas.jump (surface: ['atlas']) and
// palette.open (surface-less) share the same ⌘K default -- legal only
// because dispatchCommandForEvent tries every surface-scoped command
// matching the active view BEFORE any surface-less global.
describe('dispatchCommandForEvent surface precedence (goal 0071)', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('⌘K on the atlas surface dispatches atlas.jump, not palette.open', () => {
    useAppStore.getState().setView({ kind: 'atlas' })
    useAppStore.getState().closePalette()
    const before = useUISignalStore.getState().atlasJumpRequest
    const ran = dispatchCommandForEvent(event({ code: 'KeyK', metaKey: true }), {})
    expect(ran).toBe(true)
    expect(useUISignalStore.getState().atlasJumpRequest).toBe(before + 1)
    expect(useAppStore.getState().paletteOpen).toBe(false)
  })

  it('⌘K on a non-atlas surface dispatches palette.open, not atlas.jump', () => {
    useAppStore.getState().setView({ kind: 'composition' })
    useAppStore.getState().closePalette()
    const before = useUISignalStore.getState().atlasJumpRequest
    const ran = dispatchCommandForEvent(event({ code: 'KeyK', metaKey: true }), {})
    expect(ran).toBe(true)
    expect(useUISignalStore.getState().atlasJumpRequest).toBe(before)
    expect(useAppStore.getState().paletteOpen).toBe(true)
    useAppStore.getState().closePalette()
  })
})

// Goal 0071's Settings rebind conflict rule: a same-combo pair is only
// a real conflict when their surface sets intersect.
describe('surfacesIntersect', () => {
  it('two surface-less (global) commands intersect', () => {
    expect(surfacesIntersect(undefined, undefined)).toBe(true)
  })

  it('a surface-less command intersects every specific surface', () => {
    expect(surfacesIntersect(undefined, ['atlas'])).toBe(true)
    expect(surfacesIntersect(['atlas'], undefined)).toBe(true)
  })

  it('two commands scoped to the SAME surface intersect', () => {
    expect(surfacesIntersect(['atlas'], ['atlas'])).toBe(true)
  })

  it('two commands scoped to DISJOINT surfaces do not intersect -- sharing a combo between them is legal', () => {
    expect(surfacesIntersect(['atlas'], ['composition'])).toBe(false)
  })

  it('overlapping multi-surface lists intersect on the shared surface', () => {
    expect(surfacesIntersect(['atlas', 'composition'], ['composition', 'configure'])).toBe(true)
  })
})

// shared/atlasBoardCommands.ts's hintOnly/paletteHidden commands: their
// real dispatch lives in dedicated listeners elsewhere, never the
// generic dispatcher below (Command.hintOnly's own doc comment).
describe('hintOnly / paletteHidden commands', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('atlas.selectAll is hintOnly with its own ⌘A default binding', () => {
    const command = findCommand('atlas.selectAll')
    expect(command?.hintOnly).toBe(true)
    expect(command?.defaultBinding).toEqual({ mods: ['cmd'], key: 'A' })
  })

  it('atlas.selectAll does not carry paletteHidden', () => {
    expect(findCommand('atlas.selectAll')?.paletteHidden).toBeFalsy()
  })

  it('generic dispatch never runs atlas.selectAll, even on the atlas surface', () => {
    useAppStore.getState().setView({ kind: 'atlas' })
    const ran = dispatchCommandForEvent(event({ code: 'KeyA', metaKey: true }), {})
    expect(ran).toBe(false)
  })

  it('atlas.delete.selection and atlas.group.selection are both hintOnly and paletteHidden', () => {
    for (const id of ['atlas.delete.selection', 'atlas.group.selection']) {
      const command = findCommand(id)
      expect(command?.hintOnly).toBe(true)
      expect(command?.paletteHidden).toBe(true)
    }
  })
})
