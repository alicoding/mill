import { findCommand, effectiveBinding } from './commands'
import type { KeyCombo } from './keybinding'
import { formatCombo } from './keybinding'
import { useAppStore } from './store'

// The single O(1) read every inline hotkey hint in the app goes
// through (docs/goals/0015-summon-quick-invoke.md's single-source-of-
// truth constraint): a command's CURRENT effective binding is its
// keybindingOverrides entry (set via Settings ->
// Keyboard Shortcuts, shared/store.ts) if the user rebound it, else
// its shared/commands.ts default -- the exact same merge
// KeyboardShortcutsSection.tsx's own list already performs via
// effectiveBinding. Before this, CommandPalette.tsx and QuickPanel.tsx
// each had their own local `ShortcutHint` component computing this
// inline (one of them even had a hardcoded "⌘," text for Open
// Settings, invisible to a rebind) -- this hook/function is the one
// place that logic now lives, so a rebind in Settings is reflected
// everywhere an inline hint is shown, never a second hardcoded copy
// that can drift. Split out of HotkeyHint.tsx (goal 0419 S1b): neither
// export here is a component, so Fast Refresh needs them out of that
// file.
export function resolveHotkeyLabel(commandId: string, overrides: Record<string, KeyCombo>): string | null {
  const command = findCommand(commandId)
  if (!command) return null
  const binding = effectiveBinding(command, overrides)
  return binding ? formatCombo(binding.mods, binding.key) : null
}

export function useCommandBinding(commandId: string): string | null {
  const keybindingOverrides = useAppStore((s) => s.keybindingOverrides)
  return resolveHotkeyLabel(commandId, keybindingOverrides)
}
