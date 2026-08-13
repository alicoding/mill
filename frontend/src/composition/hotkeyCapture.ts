import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsService, TriggerService } from '../shared/bindings'
import { comboKey, describeCombo, formatCombo, keyFromEventCode, modsFromEvent, reservedByMacOS } from '../shared/keybinding'
import { refreshKeybindings, useAppStore } from '../shared/store'
import { COMMANDS, effectiveBinding } from '../shared/commands'

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

// A ComboCaptureAdapter is the one thing that varies between a
// workflow's trigger hotkey and a keymap command's keybinding (docs/
// goals/0016-keymap-system.md): which RPC loads/assigns/unassigns the
// combo. Everything else -- the menu-accelerator-suspension bracket,
// the reserved-combo rejection, the Escape/blur cancel paths -- is
// identical, so useComboCapture (below) is the one implementation both
// useHotkeyCapture and useCommandKeybindingCapture wrap.
interface ComboCaptureAdapter {
  currentBinding: () => Promise<string | null>
  assign: (mods: string[], key: string) => Promise<string>
  unassign: () => Promise<void>
}

// Extracted from the now-retired RunbookView.tsx (docs/SPEC.md §2.2's
// Update note), then generalized off its original workflow-only shape
// (docs/goals/0016-keymap-system.md) once the Settings Keyboard
// Shortcuts surface needed the identical press-to-capture flow against
// a different pair of RPCs. `enabled` replaces the old bare
// `workflowId` truthiness check as the "is there anything to capture
// for yet" gate, so a null commandId/workflowId still cleanly disables
// recording via either wrapper below.
function useComboCapture(enabled: boolean, adapter: ComboCaptureAdapter, onChanged?: () => void) {
  const { t } = useTranslation('composition')
  const [binding, setBinding] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setBinding(null)
      return
    }
    adapter.currentBinding().then(setBinding).catch(console.error)
    // adapter is a fresh object identity per render from both wrappers
    // below (a useMemo keyed on the real id, not enabled/onChanged) --
    // depending on it directly would refetch on every unrelated
    // re-render; `enabled` is the real trigger for "the target changed."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // Menu-accelerator suspension (SettingsService.SuspendMenuAccelerators)
  // brackets the entire time this hook is "recording", not just the
  // keydown listener below -- on macOS, NSMenu's own
  // performKeyEquivalent: intercepts a key-equivalent-matching keypress
  // (Cmd+W Close Window, Cmd+Q Quit, ...) at the menu-bar layer before
  // it ever reaches this listener, e.preventDefault() included -- a
  // real, live-reproduced bug (Cmd+Shift+W closed the window mid-recording,
  // and since the last window closing quits the app, that ended the
  // recording session entirely). Suspend is called unconditionally
  // whenever recording flips true; Restore is in the *same* effect's
  // cleanup, so it fires on every exit path this effect can end
  // through -- Escape, a reserved-combo rejection, a successful
  // capture (all three flip `recording` back to false, which is what
  // triggers React to run this cleanup before the next effect), an
  // unmount while still recording, and a window blur (below, the one
  // exit this hook didn't have before: alt-tabbing away mid-recording
  // used to leave the recorder armed -- and, now, the app menu
  // suspended -- indefinitely).
  useEffect(() => {
    if (!recording || !enabled) return

    SettingsService.SuspendMenuAccelerators().catch(console.error)

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

      const reserved = reservedByMacOS(mods, key)
      if (reserved) {
        setRecording(false)
        setError(t('hotkeyCapture.reservedByMacOS', { combo: describeCombo(mods, key), reason: reserved }))
        return
      }

      setRecording(false)
      setError('')
      adapter.assign(mods, key)
        .then((label) => { setBinding(label); onChanged?.() })
        .catch((err) => setError(String(err)))
    }
    // A blur mid-recording (alt-tab, clicking another app) must cancel
    // the recording, not just leave it silently armed -- without this,
    // there was no path back to Restore until the user refocused Mill
    // and pressed Escape themselves.
    const onBlur = () => setRecording(false)

    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeydown, true)
      window.removeEventListener('blur', onBlur)
      SettingsService.RestoreMenuAccelerators().catch(console.error)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, enabled, onChanged])

  const clear = () => {
    if (!enabled) return
    adapter.unassign().then(() => { setBinding(null); onChanged?.() })
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

// onChanged is optional and fires after a successful assign/unassign --
// added for the Workflows-list row's inline capture (TriggerRowLabel.tsx,
// docs/goals/0006-trigger-aware-workflows-list.md): a hotkey binding
// existing is necessary but not sufficient for "armed" (TriggerService's
// Sync gate also needs the workflow published+enabled), so the row needs
// to refetch TriggerService.ArmedWorkflows() once binding state actually
// changes. NodeInspector.tsx's existing single-arg call is unaffected.
export function useHotkeyCapture(workflowId: string | null, onChanged?: () => void) {
  const adapter = useMemo<ComboCaptureAdapter>(() => ({
    currentBinding: () => TriggerService.ListHotkeys().then((list) => (list ?? {})[workflowId ?? ''] ?? null),
    assign: (mods, key) => TriggerService.AssignHotkey(workflowId ?? '', mods, key),
    unassign: () => TriggerService.UnassignHotkey(workflowId ?? ''),
  }), [workflowId])
  return useComboCapture(workflowId !== null, adapter, onChanged)
}

// The Settings → Keyboard Shortcuts surface's own capture, over
// SettingsService.SetKeybinding/ClearKeybinding/ListKeybindings instead
// of TriggerService's per-workflow RPCs -- same recorder UX
// (docs/goals/0016-keymap-system.md's own explicit ask), a different
// backing store. Refreshes the shared store's keybindingOverrides
// (shared/store.ts) on every successful change, not just the caller's
// own onChanged, since the command dispatcher (App.tsx) reads that
// store directly and needs the new binding live immediately -- a
// rebound command works without a reload.
export function useCommandKeybindingCapture(commandId: string | null, onChanged?: () => void) {
  const { t } = useTranslation('composition')
  const adapter = useMemo<ComboCaptureAdapter>(() => ({
    currentBinding: () => SettingsService.ListKeybindings().then((map) => {
      const hk = (map ?? {})[commandId ?? '']
      // ListKeybindings returns raw Mods/Key, not a pre-formatted label
      // (settingsservice_keymap.go's own doc comment on why) -- rendered
      // through the same formatCombo a command's frontend-only default
      // uses, so an overridden binding never looks different from one
      // that hasn't been touched yet.
      return hk ? formatCombo(hk.mods ?? [], hk.key) : null
    }),
    assign: (mods, key) => {
      // The half of the conflict check settingsservice_keymap.go's own
      // header comment says the backend structurally can't do: a clash
      // against a command still on its frontend-only DEFAULT (never
      // round-tripped through SetKeybinding, so the backend has never
      // heard of it). Checked here, against every OTHER command's
      // current EFFECTIVE binding (default merged with whatever's
      // already overridden), before the RPC is ever called -- an
      // override-vs-override or override-vs-workflow-hotkey clash still
      // gets caught server-side either way.
      const overrides = useAppStore.getState().keybindingOverrides
      const want = comboKey(mods, key)
      const clash = COMMANDS.find((c) => {
        if (c.id === commandId) return false
        const binding = effectiveBinding(c, overrides)
        return binding !== null && comboKey(binding.mods, binding.key) === want
      })
      if (clash) {
        return Promise.reject(new Error(t('hotkeyCapture.clashWithCommand', { label: clash.label })))
      }
      return SettingsService.SetKeybinding(commandId ?? '', mods, key).then((label) => {
        void refreshKeybindings()
        return label
      })
    },
    unassign: () => SettingsService.ClearKeybinding(commandId ?? '').then(() => { void refreshKeybindings() }),
  }), [commandId, t])
  return useComboCapture(commandId !== null, adapter, onChanged)
}
