import { useEffect } from 'react'
import { dispatchCommandForEvent } from '../shared/commands'
import { isEditableTarget } from '../shared/keybinding'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'

// App.tsx's window-level keydown handling, split out (CLAUDE.md's
// 500-line convention) as its own hook rather than inline effects --
// the two listeners stay logically one unit (both react to every
// keydown the window sees) even though they're structurally
// independent.
//
// Listener 1, the keymap system's one dispatcher (docs/goals/0016-
// keymap-system.md): resolves a pressed combo against every command's
// current EFFECTIVE binding (shared/commands.ts's dispatchCommandForEvent
// -- default, or the store's own keybindingOverrides if the user
// rebound it in Settings) and runs the first match. This is the direct
// successor to the old, hardcoded Cmd+1-4/Cmd+, VIEW_HOTKEYS handler --
// those four are now just ordinary commands (view.composition/
// configure/activity/review, settings.open) in COMMANDS, dispatched
// the exact same way, not a second parallel handler. Deliberately
// in-window-only, not a global OS-level hotkey, same reasoning the old
// handler already had: plain browser keydown handling is the
// reversible/safer default, distinct from TriggerService's real
// OS-level golang.design/x/hotkey registration (§3.4) that per-
// workflow and summon hotkeys use. Active regardless of which element
// has focus (comboFromEvent itself requires Cmd or Ctrl, never a bare
// key a text field would otherwise consume) -- matches browsers'/
// Slack's own Cmd+1-9 tab-switching precedent.
//
// Listener 2, the bare-`?` shortcuts-help overlay (goal 0071):
// deliberately a second, dedicated listener rather than folded into
// dispatchCommandForEvent above -- comboFromEvent requires Cmd/Ctrl by
// design (every OTHER keymap default needs one of the two, so a future
// rebind to a bare Shift+letter can't accidentally intercept normal
// typing), and `?` is a bare key with no such modifier. Gated on the
// same isEditableTarget check every recorder in this app already uses,
// PLUS "no dialog already open" (any Primer Dialog renders
// role="dialog") -- typing `?` inside the atlas jump dialog's own
// search input, or any other open dialog, must never also pop this one
// open behind/over it.
export function useKeymapDispatch(): void {
  const keybindingOverrides = useAppStore((s) => s.keybindingOverrides)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (dispatchCommandForEvent(e, keybindingOverrides)) {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [keybindingOverrides])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      useUISignalStore.getState().openHelp()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
