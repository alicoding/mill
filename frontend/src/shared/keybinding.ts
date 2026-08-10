// Physical-key-position based, so the recorder doesn't care about Shift state.
// event.code is "KeyM" / "Digit1" / "Space" — this strips the prefix.
export function keyFromEventCode(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Space'
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
// -- Mill has no client-side ⌘/⌥ glyph formatter today (the backend's
// own FormatBinding, triggerservice.go, is server-side only; every
// binding label the frontend shows is already-formatted text it
// received back from a Wails call), and inventing one just for this
// message would be new UI surface out of proportion to what a rejected
// pre-flight check needs.
export function describeCombo(mods: string[], key: string): string {
  const capitalized = mods.map((m) => m[0].toUpperCase() + m.slice(1))
  return [...capitalized, key].join('+')
}
