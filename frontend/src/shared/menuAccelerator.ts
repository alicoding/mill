import type { KeyCombo } from './keybinding'

// Mill's modifier vocabulary translated into the one Wails' own
// accelerator parser accepts (pkg/application/keys.go's modifierMap):
// 'cmd' is the Command key on macOS, which that parser spells
// "cmdorctrl"; 'ctrl' is the physical Control key, spelled "ctrl".
const MOD_TO_WAILS: Record<string, string> = {
  cmd: 'cmdorctrl',
  ctrl: 'ctrl',
  option: 'option',
  shift: 'shift',
}

// The order modifiers are emitted in. Wails re-sorts them for display,
// so this only has to be stable, not meaningful.
const MOD_ORDER = ['cmd', 'ctrl', 'option', 'shift']

// Mill key names that are NOT a single printable character, mapped onto
// the named keys Wails' parseKey accepts (its own namedKeys table).
// '+' MUST go out as "plus": the parser splits the accelerator string on
// '+', so a literal plus sign would split into empty components and be
// rejected outright.
const KEY_TO_WAILS: Record<string, string> = {
  Enter: 'enter',
  Tab: 'tab',
  Space: 'space',
  Escape: 'escape',
  Delete: 'delete',
  Backspace: 'backspace',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  '+': 'plus',
}

// toWailsAccelerator renders a KeyCombo as the accelerator string a
// native menu item takes, or null when the combo cannot be expressed --
// an unmapped multi-character key would be rejected by the parser at
// runtime and silently leave the item unaccelerated, so it is refused
// here where a test can see it.
export function toWailsAccelerator(combo: KeyCombo): string | null {
  const key = KEY_TO_WAILS[combo.key] ?? (combo.key.length === 1 ? combo.key.toLowerCase() : null)
  if (key === null) return null
  const mods = MOD_ORDER.filter((m) => combo.mods.includes(m)).map((m) => MOD_TO_WAILS[m])
  // A bare, modifier-less key equivalent would fire on every keystroke
  // that reaches the menu bar, including plain typing.
  if (mods.length === 0) return null
  return [...mods, key].join('+')
}
