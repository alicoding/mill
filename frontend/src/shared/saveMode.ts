import { useSyncExternalStore } from 'react'
import { SettingsService } from './bindings'

// The "Save changes" preference (goal 0295 S2b), mirrored from the
// settings service so every surface reads it synchronously:
//
// - 'automatic' (default) -- an edit commits the moment its surface's
//   own commit fires (click-away, Enter, the canvas draft timer); quit
//   and restart flush whatever is still live and never ask.
// - 'explicit' -- an edit waits until the user saves it: the surface
//   holds it with a dirty marker, ⌘S saves the focused surface, and
//   quit / restart / close hold behind a Save all / Discard / Cancel
//   sheet (app/UnsavedChangesDialog.tsx).
//
// Converged shape: VS Code's files.autoSave (off / afterDelay ...) is
// a separate knob from its hot exit; macOS document apps autosave in
// place and only explicit-save apps show the "Save changes?" sheet.
// Mill's default is autosave; explicit mode is the option.
export type SaveMode = 'automatic' | 'explicit'

let current: SaveMode = 'automatic'
const listeners = new Set<() => void>()

function set(mode: SaveMode): void {
  if (current === mode) return
  current = mode
  listeners.forEach((l) => l())
}

export function modeFromStored(value: unknown): SaveMode {
  return value === 'explicit' ? 'explicit' : 'automatic'
}

export function getSaveMode(): SaveMode {
  return current
}

// Loads the persisted mode once per page (App mounts it via
// useBeforeQuitFlush); a failed load leaves the default in place.
export async function loadSaveMode(): Promise<void> {
  try {
    set(modeFromStored(await SettingsService.GetSaveMode()))
  } catch (err) {
    console.error(err)
  }
}

export async function setSaveMode(mode: SaveMode): Promise<void> {
  await SettingsService.SetSaveMode(mode)
  set(mode)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSaveMode(): SaveMode {
  return useSyncExternalStore(subscribe, getSaveMode)
}
