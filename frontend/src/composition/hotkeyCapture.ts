import { useEffect, useState } from 'react'
import { TriggerService } from '../shared/bindings'
import { keyFromEventCode, modsFromEvent } from '../shared/keybinding'

// SPEC.md §2.2's "Permissions UX pattern" -- deep-link straight into the
// exact System Settings pane instead of telling the user to go find it
// themselves, same pattern Hammerspoon/Raycast/1Password use. Verified
// directly against this machine's actual macOS version (26.5.2) rather
// than assumed -- these identifiers are unofficial and have broken
// across System Settings rewrites before, so re-verify if this stops
// landing on the right pane after a macOS update.
export const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

export function isAccessibilityError(message: string): boolean {
  return message.includes('Accessibility')
}

// Extracted from the now-retired RunbookView.tsx (docs/SPEC.md §2.2's
// Update note) -- the press-to-capture flow itself had no Runbook-
// specific assumptions in it, just an actionID; generalizing it to a
// workflowID is the only real change. Scoped to one workflow at a time
// (RunbookView managed a whole list's worth of bindings at once; a
// CompositionCanvas Inspector only ever configures the one workflow
// currently open), so this hook's shape is simpler than the view it came
// from, not a like-for-like port.
//
// onChanged is optional and fires after a successful assign/unassign --
// added for the Workflows-list row's inline capture (TriggerRowLabel.tsx,
// docs/goals/0006-trigger-aware-workflows-list.md): a hotkey binding
// existing is necessary but not sufficient for "armed" (TriggerService's
// Sync gate also needs the workflow published+enabled), so the row needs
// to refetch TriggerService.ArmedWorkflows() once binding state actually
// changes. NodeInspector.tsx's existing single-arg call is unaffected.
export function useHotkeyCapture(workflowId: string | null, onChanged?: () => void) {
  const [binding, setBinding] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!workflowId) {
      setBinding(null)
      return
    }
    TriggerService.ListHotkeys()
      .then((list) => setBinding((list ?? {})[workflowId] ?? null))
      .catch(console.error)
  }, [workflowId])

  useEffect(() => {
    if (!recording || !workflowId) return

    const onKeydown = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') {
        setRecording(false)
        return
      }
      const key = keyFromEventCode(e.code)
      if (!key) return // modifier-only press, or an unsupported key -- keep waiting
      const mods = modsFromEvent(e)
      if (mods.length === 0) return // require at least one modifier

      setRecording(false)
      setError('')
      TriggerService.AssignHotkey(workflowId, mods, key)
        .then((label) => { setBinding(label); onChanged?.() })
        .catch((err) => setError(String(err)))
    }

    window.addEventListener('keydown', onKeydown, true)
    return () => window.removeEventListener('keydown', onKeydown, true)
  }, [recording, workflowId, onChanged])

  const clear = () => {
    if (!workflowId) return
    TriggerService.UnassignHotkey(workflowId).then(() => { setBinding(null); onChanged?.() })
  }

  return {
    binding,
    error,
    recording,
    startRecording: () => setRecording(true),
    cancelRecording: () => setRecording(false),
    clear,
  }
}
