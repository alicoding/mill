import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMANDS, findCommand } from './commands'
import { dispatchCommandForEvent } from './commandDispatch'
import { comboKey } from './keybinding'
import { isMenuOwnedCombo, setMenuOwnedCombos } from './menuOwnership'
import { useAppStore } from './store'

// Exactly one owner per combo (goal 0332). A combo the native menu bar
// carries is intercepted before the keypress reaches the page, so the
// in-window dispatcher must not claim it too; where no menu bar exists
// (server mode, the browser companion) the set is empty and the
// dispatcher keeps everything, exactly as before.

// The four fields comboFromEvent actually reads (shared/keybinding.ts).
// A literal, not a real KeyboardEvent: this suite runs without a DOM.
function pressing(mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean }, code: string): KeyboardEvent {
  return {
    code,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  } as KeyboardEvent
}

afterEach(() => {
  setMenuOwnedCombos([])
  vi.restoreAllMocks()
})

describe('menu-owned combos', () => {
  it('are skipped by the keydown dispatcher', () => {
    const run = vi.spyOn(findCommand('view.home')!, 'run').mockImplementation(() => {})
    expect(dispatchCommandForEvent(pressing({ meta: true }, 'Digit0'), {})).toBe(true)
    run.mockClear()

    setMenuOwnedCombos([comboKey(['cmd'], '0')])
    expect(dispatchCommandForEvent(pressing({ meta: true }, 'Digit0'), {})).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('leave every other combo with the dispatcher', () => {
    useAppStore.setState({ view: { kind: 'home' } })
    setMenuOwnedCombos([comboKey(['cmd'], '0')])
    const run = vi.spyOn(findCommand('view.configure')!, 'run').mockImplementation(() => {})
    expect(dispatchCommandForEvent(pressing({ meta: true }, 'Digit2'), {})).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('start empty, so nothing is claimed until a native menu is actually installed', () => {
    // Server mode and the browser companion never install a menu, and
    // the emptiness IS their contract: the dispatcher keeps every combo.
    const placed = COMMANDS.find((c) => c.menu !== undefined && c.defaultBinding && !c.hintOnly)!
    const binding = placed.defaultBinding!
    expect(isMenuOwnedCombo(comboKey(binding.mods, binding.key))).toBe(false)
  })
})
