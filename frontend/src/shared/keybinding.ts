// Physical-key-position based, so the recorder doesn't care about Shift state.
// event.code is "KeyM" / "Digit1" / "Space" — this strips the prefix.
//
// Tab/Comma support (goal 0016-keymap-system.md) -- the reserved-combo
// list below already listed Cmd+Tab "defensively, in case
// keyFromEventCode ever grows Tab support"; the keymap's own default
// bindings (⌃Tab/⌃⇧Tab for tab.next/prev, ⌘, for settings.open) are
// exactly that day arriving. Enter/NumpadEnter (workflow.run's own
// ⌘↩ default, moved off ⌘R by owner decision so native Reload stays
// available) both normalize to the single 'Enter' key -- the main
// Return key and the numpad Enter key are the same logical action for
// a "run/submit" combo, no reason to treat them as different bindings.
export function keyFromEventCode(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Space'
  if (code === 'Tab') return 'Tab'
  if (code === 'Comma') return ','
  if (code === 'Enter' || code === 'NumpadEnter') return 'Enter'
  // docs/goals/BACKLOG.md Standing #6 (⌘?/⌘/ palette aliases): the
  // physical key is the same whether Shift is held or not (Shift+/
  // producing '?' is exactly the shift-independence this function's
  // own header comment already documents for every other key) -- the
  // Shift MOD is what distinguishes ⌘/ from ⌘? at the KeyCombo level
  // (modsFromEvent below), not a second key value here.
  if (code === 'Slash') return '/'
  // Bracket keys exist for tab.next/tab.prev's ⌘⇧]/⌘⇧[ extra bindings
  // (shared/commands.ts) -- the browser convention for cycling tabs.
  // Shift-independent like every other key here: the '{'/'}' glyphs are
  // the same physical keys, distinguished only by the Shift mod.
  if (code === 'BracketLeft') return '['
  if (code === 'BracketRight') return ']'
  return null
}

export function modsFromEvent(e: KeyboardEvent): string[] {
  const mods: string[] = []
  if (e.metaKey) mods.push('cmd')
  if (e.ctrlKey) mods.push('ctrl')
  if (e.shiftKey) mods.push('shift')
  if (e.altKey) mods.push('option')
  return mods
}

// Combos macOS itself intercepts globally -- Spotlight, screenshots,
// input-source switching, App Switcher, Log Out -- before any app,
// Mill included, ever sees the keypress. No amount of menu-accelerator
// suspension (SettingsService.SuspendMenuAccelerators) can route these
// to a recorder: the OS itself owns them, not an NSMenuItem Mill's own
// application menu could strip. Rejecting them outright at record time
// is the second, independent layer -- SuspendMenuAccelerators handles
// Mill's *own* menu (Cmd+W, Cmd+Q, ...), this handles the OS's.
//
// Scoped to what keyFromEventCode can actually produce (letters,
// digits, Space -- Tab/Escape/arrows never reach a recorder as a real
// combo attempt today, see keyFromEventCode above), not an exhaustive
// OS-shortcut list. Cmd+Tab is listed anyway, defensively, in case
// keyFromEventCode ever grows Tab support -- it costs nothing to keep
// correct ahead of that. These are macOS's own documented defaults
// (System Settings > Keyboard > Keyboard Shortcuts); a user who
// reassigned or disabled one system-side won't be blocked here, but
// Mill has no way to detect that, so treating the default as reserved
// is the fail-safe reading, not a claim of perfect coverage.
const RESERVED_COMBOS: readonly { mods: readonly string[]; key: string; reason: string }[] = [
  { mods: ['cmd'], key: 'Space', reason: 'Spotlight' },
  { mods: ['cmd', 'option'], key: 'Space', reason: 'Finder search' },
  { mods: ['ctrl'], key: 'Space', reason: 'input source switching' },
  { mods: ['cmd', 'shift'], key: '3', reason: 'screenshot' },
  { mods: ['cmd', 'shift'], key: '4', reason: 'screenshot' },
  { mods: ['cmd', 'shift'], key: '5', reason: 'screenshot / screen recording' },
  { mods: ['cmd', 'shift'], key: 'Q', reason: 'Log Out' },
  { mods: ['cmd'], key: 'Tab', reason: 'App Switcher' },
  { mods: ['cmd', 'shift'], key: 'Tab', reason: 'App Switcher (reverse)' },
]

function sameModSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((m, i) => m === sb[i])
}

// Returns why a combo is reserved by macOS itself (e.g. "Spotlight"),
// or null when it's safe to record.
export function reservedByMacOS(mods: string[], key: string): string | null {
  const match = RESERVED_COMBOS.find((c) => c.key === key && sameModSet(c.mods, mods))
  return match ? match.reason : null
}

// Plain, glyph-free rendering for the reserved-combo rejection message
// -- kept spelled-out ("Cmd+Shift+3") rather than symbols specifically
// for that error copy's own readability; formatCombo below (goal 0016)
// is the symbol-glyph renderer used everywhere a binding is actually
// displayed as a shortcut.
export function describeCombo(mods: string[], key: string): string {
  const capitalized = mods.map((m) => m[0].toUpperCase() + m.slice(1))
  return [...capitalized, key].join('+')
}

// --- Command keymap support (docs/goals/0016-keymap-system.md) -------
//
// A KeyCombo is the wire/storage shape both the frontend and Go side
// agree on: `mods` lowercase ('cmd'/'ctrl'/'shift'/'option'), `key` in
// keyFromEventCode's own format (a bare uppercase letter/digit,
// 'Space', 'Tab', or ','). Lives here, not in shared/commands.ts or
// shared/store.ts, so both of those can import it without a circular
// dependency (commands.ts reads from the store; store.ts would need
// this same type for its keybindingOverrides field).
export interface KeyCombo {
  mods: string[]
  key: string
}

// comboFromEvent turns a live keydown into the same KeyCombo shape a
// hotkey recorder captures -- shift-independent (physical key, via
// keyFromEventCode), and requires Cmd or Ctrl specifically (not just
// "any modifier"): every keymap default needs one of the two, and
// gating on them here means an arbitrary future rebind to a bare
// Shift+letter/Option+letter combo still can't accidentally intercept
// normal typing (Shift held to produce an uppercase letter is common;
// Cmd/Ctrl held during typing is not). Returns null for anything that
// isn't a real combo attempt -- a modifier-only press, an unsupported
// key, or no Cmd/Ctrl at all.
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  if (!e.metaKey && !e.ctrlKey) return null
  const key = keyFromEventCode(e.code)
  if (!key) return null
  const mods = modsFromEvent(e)
  return { mods, key }
}

// comboKey normalizes a KeyCombo into a stable, mod-order-independent
// string for equality/lookup -- deliberately the same shape as the Go
// side's internal/domain/trigger.comboKey (sorted mods, uppercased),
// so "cmd+shift+S" and "shift+cmd+S" collide as the same combo on both
// sides of the wire.
export function comboKey(mods: string[], key: string): string {
  return [...mods].map((m) => m.toLowerCase()).sort().join('+').toUpperCase() + '+' + key.toUpperCase()
}

const MOD_SYMBOL: Record<string, string> = { cmd: '⌘', ctrl: '⌃', shift: '⇧', option: '⌥', alt: '⌥' }

// Keys with a real macOS glyph convention (Apple's own menu-shortcut
// rendering, e.g. Mail's "Send ⌘↩") rather than a spelled-out name --
// checked against Apple's own usage before picking ↩, not invented.
// Only Enter needs this today; Tab/Space stay spelled out (TAB/SPACE),
// unchanged, since nothing has asked for those as glyphs.
const KEY_SYMBOL: Record<string, string> = { Enter: '↩' }

// formatCombo renders a KeyCombo as a compact symbol string (e.g.
// "⌘⇧S"), mirroring triggersvc.FormatBinding (Go) exactly for mods --
// same symbol table, same "mods in the order given, then the key"
// shape; the key itself prefers KEY_SYMBOL over a spelled-out
// uppercase name when one exists. Used for BOTH a command's
// frontend-only default binding (which never touches Go) and an
// overridden one (SettingsService.ListKeybindings returns raw
// mods/key, not a pre-formatted label, precisely so both render
// through this one function instead of two slightly different
// formatters drifting apart).
export function formatCombo(mods: string[], key: string): string {
  return mods.map((m) => MOD_SYMBOL[m.toLowerCase()] ?? m).join('') + (KEY_SYMBOL[key] ?? key.toUpperCase())
}
