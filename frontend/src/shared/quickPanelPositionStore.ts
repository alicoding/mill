import { create } from 'zustand'
import { SettingsService } from './bindings'
import { background } from './background'

// The Quick Panel position door (goal 0377): whether a dragged
// position is currently saved, lifted into its own store the same
// "second store file" way vaultStatusStore.ts already establishes --
// panel.resetPosition's enabled() predicate (shared/settingsCommands.ts)
// needs this synchronously, and the drag itself happens in the Quick
// Panel's own separate Wails window/JS context (docs/adr/0033), so the
// MAIN window's command palette can't just read a local variable. Kept
// current via the mill-data-changed 'quickpanel-position' entity
// (useDataChangedRouter.ts) rather than polling.
interface QuickPanelPositionState {
  hasCustomPosition: boolean
  setHasCustomPosition: (hasCustomPosition: boolean) => void
}

export const useQuickPanelPositionStore = create<QuickPanelPositionState>()((set) => ({
  hasCustomPosition: false,
  setHasCustomPosition: (hasCustomPosition) => set({ hasCustomPosition }),
}))

// Mirrors vaultStatusStore.ts's refreshVaultStatus shape: the one
// refetch path, callable from App.tsx's boot effect and the
// mill-data-changed router without prop threading.
export function refreshHasCustomPanelPosition(): Promise<void> {
  return background(SettingsService.HasCustomPanelPosition()
    .then((has) => useQuickPanelPositionStore.getState().setHasCustomPosition(has)), 'quickPanelPosition.hasCustomPosition')
}
