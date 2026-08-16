import { describe, expect, it } from 'vitest'
import { resolveHotkeyLabel } from './HotkeyHint'
import type { KeyCombo } from './keybinding'

// docs/goals/0015-summon-quick-invoke.md's inline-hotkey-hint
// remainder: the resolution step every inline hint (WorkTabShell's
// tab-overflow menu, QuickPanel's rows, the command palette) shares.
// Covers the three cases the goal's own DoD names: a command on its
// shared/commands.ts default, one with a Settings override in play,
// and "no binding" (nothing to render, never a placeholder/broken
// chip).
describe('resolveHotkeyLabel', () => {
  it('formats a command still on its shared/commands.ts default when no override exists', () => {
    // tab.close's own default binding (shared/commands.ts) -- Cmd+W.
    expect(resolveHotkeyLabel('tab.close', {})).toBe('⌘W')
  })

  it('formats the Settings override instead of the default once one is set, without a second source', () => {
    const overrides: Record<string, KeyCombo> = { 'tab.close': { mods: ['cmd', 'shift'], key: 'W' } }
    // Same command id, same resolver -- only the overrides map changed,
    // proving there's no second hardcoded copy anywhere to drift.
    expect(resolveHotkeyLabel('tab.close', overrides)).toBe('⌘⇧W')
  })

  it('the two new tab-management commands resolve to their own real defaults', () => {
    expect(resolveHotkeyLabel('tab.closeOthers', {})).toBe('⌘⌥W')
    expect(resolveHotkeyLabel('tab.closeAll', {})).toBe('⌘⇧W')
  })

  it('returns null (renders nothing) for a command id that resolves to no binding at all', () => {
    // Every command in shared/commands.ts today has a non-null
    // defaultBinding (its own Command interface doc comment: "none
    // exist yet" that don't) -- the one real path to "no binding" is a
    // command id the registry doesn't recognize, which is exactly what
    // HotkeyHint's own null-check guards against ever rendering a
    // placeholder/broken chip for.
    expect(resolveHotkeyLabel('not.a.real.command', {})).toBeNull()
  })

  it('an override on an unrelated command never leaks into a different command\'s resolved label', () => {
    const overrides: Record<string, KeyCombo> = { 'workflow.save': { mods: ['cmd', 'shift'], key: 'S' } }
    expect(resolveHotkeyLabel('tab.close', overrides)).toBe('⌘W')
  })
})
