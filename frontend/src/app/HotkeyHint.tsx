import { findCommand, effectiveBinding } from '../shared/commands'
import type { KeyCombo } from '../shared/keybinding'
import { formatCombo } from '../shared/keybinding'
import { useAppStore } from '../shared/store'
import { KeyComboChip } from '../shared/KeyComboChip'

// The single O(1) read every inline hotkey hint in the app goes
// through (docs/goals/0015-summon-quick-invoke.md, owner's explicit
// "single source of truth" constraint): a command's CURRENT effective
// binding is its keybindingOverrides entry (set via Settings ->
// Keyboard Shortcuts, shared/store.ts) if the owner rebound it, else
// its shared/commands.ts default -- the exact same merge
// KeyboardShortcutsSection.tsx's own list already performs via
// effectiveBinding. Before this, CommandPalette.tsx and QuickPanel.tsx
// each had their own local `ShortcutHint` component computing this
// inline (one of them even had a hardcoded "⌘," text for Open
// Settings, invisible to a rebind) -- this hook/component is the one
// place that logic now lives, so a rebind in Settings is reflected
// everywhere an inline hint is shown, never a second hardcoded copy
// that can drift.
//
// Split out of useCommandBinding as a plain function so it's directly
// Vitest-unit-testable (HotkeyHint.test.ts) without a React render --
// this repo's frontend toolchain has no @testing-library/react
// installed (checked package.json before reaching for it), and this
// resolution step has no React dependency of its own anyway.
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

// Renders nothing for a command with no binding (defaultBinding null
// and no override) -- never a placeholder/broken chip, per this goal's
// own acceptance bar. commandId is intentionally loose (a plain
// string, not a Command['id'] union) since every caller sources it
// from shared/commands.ts's own COMMANDS list already, not a literal.
export function HotkeyHint({ commandId }: { commandId: string }) {
  const label = useCommandBinding(commandId)
  if (!label) return null
  return <KeyComboChip label={label} data-testid="hotkey-hint" data-command-id={commandId} />
}
