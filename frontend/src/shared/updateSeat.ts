import type { SeatOverride } from './menuSpec'
import { copy } from './copy'
import { UpdateState } from './bindings'

// The update seat's own state -> {command, label, enabled} table (goal
// 0335): the menu bar band under About shows exactly one item for the
// whole update lifecycle, following the same UpdateState every other
// update surface (the footer pill, Settings) already renders off,
// rather than a permanent "Check for updates…" that goes stale once a
// download is ready. Pure -- shared/menuBridge.ts is the one caller,
// so this stays unit-testable across every state without a store.
export function updateSeatFor(state: UpdateState, version: string): SeatOverride {
  switch (state) {
    case UpdateState.UpdateStateChecking:
      return { commandId: 'update.check', label: 'seats.update.checking', enabled: false }
    case UpdateState.UpdateStateAvailable:
      return { commandId: 'update.downloadAndInstall', label: copy('seats.update.available', { version }), enabled: true }
    case UpdateState.UpdateStateDownloading:
      return { commandId: 'update.downloadAndInstall', label: copy('seats.update.downloading', { version }), enabled: false }
    case UpdateState.UpdateStateReady:
      return { commandId: 'update.relaunch', label: 'seats.update.ready', enabled: true }
    // Idle, error, and the Go zero value all read the same as "nothing
    // known yet, offer to look" -- the failure itself stays in the
    // footer pill/Settings, never repeated in the menu bar.
    default:
      return { commandId: 'update.check', label: 'seats.update.check', enabled: true }
  }
}
