import { useEffect } from 'react'
import { dispatchCommandForEvent, findCommand, isWorkflowEditorTabActive } from '../shared/commands'
import { comboFromEvent, comboKey, isEditableTarget } from '../shared/keybinding'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { ATLAS_TOOL_IDENTITIES } from '../shared/atlasToolIdentity'

// canvas.undo/redo/zoomIn/zoomOut's own dispatch (Listener 6, below):
// every id this listener may match, in match-priority order (only ever
// one, since each carries a distinct combo).
const CANVAS_COMMAND_IDS = ['canvas.undo', 'canvas.redo', 'canvas.zoomIn', 'canvas.zoomOut'] as const

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
//
// Listener 3, the Atlas creation tray's bare C/N/A (goal 0081 slices
// A1/A2): same structural reason as Listener 2 -- atlas.create.card/
// note/area's bare-letter default can never be a real
// dispatchCommandForEvent match (comboFromEvent's own Cmd/Ctrl
// requirement), so this is the SAME minimal, already-established shape
// extended to a third key, not a new parallel mechanism.
// Atlas-surface-scoped (unlike `?`, which is global): a stray
// "c"/"n"/"a" typed anywhere else in the app must never arm anything.
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (useAppStore.getState().view.kind !== 'atlas') return
      if (isEditableTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      const key = e.key.toUpperCase()
      const tool = ATLAS_TOOL_IDENTITIES.find((t) => t.shortcutKey === key)
      if (!tool) return
      e.preventDefault()
      findCommand(`atlas.create.${tool.id}`)?.run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Listener 4, the quick-delete undo toast's own ⌘Z (goal 0093):
  // deliberately its own dedicated listener rather than a normal
  // dispatchCommandForEvent match -- ⌘Z is ALSO the native text-undo
  // combo, and dispatchCommandForEvent's tryRun preventDefaults
  // unconditionally on any binding match, which would swallow native
  // undo inside a title/note/field input the moment atlas.undoDelete
  // had a real default binding. Only intercepts (and only
  // preventDefaults) while a toast is actually pending, on the atlas
  // surface, and the target isn't editable -- every other ⌘Z falls
  // through untouched, same as if this listener didn't exist.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.key.toUpperCase() !== 'Z') return
      if (useAppStore.getState().view.kind !== 'atlas') return
      if (!useUISignalStore.getState().atlasUndoDeletePending) return
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      findCommand('atlas.undoDelete')?.run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Listener 5, atlas.selectAll's own ⌘A (shared/atlasBoardCommands.ts):
  // same reasoning as Listener 4 above -- ⌘A is ALSO the native
  // select-all-text combo, so a generic dispatchCommandForEvent match
  // (which preventDefaults unconditionally) would break it inside any
  // Atlas input. Gated the same way Listener 3 gates bare C/N/A: atlas
  // surface only, no open dialog, never an editable target.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.key.toUpperCase() !== 'A') return
      if (useAppStore.getState().view.kind !== 'atlas') return
      if (isEditableTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      findCommand('atlas.selectAll')?.run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Listener 6, canvas.undo/redo/zoomIn/zoomOut (shared/canvasCommands.ts,
  // docs/goals/0162 item 2): ⌘Z/⌘⇧Z collide with native text-undo the
  // same way atlas.undoDelete's own ⌘Z does (Listener 4) -- a dedicated,
  // editable-target-guarded listener rather than a normal
  // dispatchCommandForEvent match. ⌘+/⌘- carry no native in-field
  // meaning but ride the same listener anyway: none of these four
  // should ever move the canvas out from under someone mid-edit, so all
  // four share one gate. Scoped to an actually-open workflow editor tab
  // (not just the composition view.kind), which is also what keeps this
  // from ever contesting view.home's own global ⌘0 -- fit-view (the
  // fifth canvas command) carries no default binding at all precisely
  // to avoid that clash, see canvasCommands.ts's own comment.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      if (!isWorkflowEditorTabActive()) return
      const pressed = comboFromEvent(e)
      if (!pressed) return
      const want = comboKey(pressed.mods, pressed.key)
      for (const id of CANVAS_COMMAND_IDS) {
        const command = findCommand(id)
        const binding = command?.defaultBinding
        if (binding && comboKey(binding.mods, binding.key) === want) {
          e.preventDefault()
          command.run()
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
