import { comboFromEvent, comboKey, type KeyCombo } from '../shared/keybinding'

type PaletteKeyEvent = Pick<KeyboardEvent, 'isTrusted' | 'repeat' | 'isComposing' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'code'>

// A frame forwards one deliberately narrow capability: a trusted
// physical keydown that currently matches a host-advertised palette
// binding. It never forwards arbitrary keys or manufactures DOM input.
export function paletteShortcutForEvent(event: PaletteKeyEvent, advertised: readonly KeyCombo[]): KeyCombo | null {
  if (!event.isTrusted || event.repeat || event.isComposing) return null
  const pressed = comboFromEvent(event as KeyboardEvent)
  if (!pressed) return null
  const key = comboKey(pressed.mods, pressed.key)
  return advertised.some((binding) => comboKey(binding.mods, binding.key) === key) ? pressed : null
}
