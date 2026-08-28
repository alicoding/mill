import { create } from 'zustand'
import { SettingsService } from './bindings'

// Which canvas extensions (atlas/atlasTools.ts's own registry) the user
// has turned off (Settings > Extensions) -- lifted into its own store,
// same "second store file, not more fields on store.ts" placement
// vaultStatusStore.ts already established (CLAUDE.md's 500-line
// convention -- store.ts is already near it). shared/commands.ts's
// atlas.create.<id> enablement predicates and AtlasCreationTray.tsx's
// own tray filter both need synchronous, non-React access to the same
// truth, the same reason vaultStatusStore exists for secrets.lockVault/
// unlockVault.
interface ExtensionEnablementState {
  disabledExtensionIds: string[]
  setDisabledExtensionIds: (ids: string[]) => void
}

export const useExtensionEnablementStore = create<ExtensionEnablementState>()((set) => ({
  disabledExtensionIds: [],
  setDisabledExtensionIds: (disabledExtensionIds) => set({ disabledExtensionIds }),
}))

// isExtensionEnabled -- the one predicate every consumer (tray filter,
// palette/keymap `enabled()`, the diagram embedded-edit-door gate)
// reads instead of inlining `!disabledExtensionIds.includes(id)`
// itself. An id never disabled (the common case) reads enabled with no
// store lookup cost beyond the array scan.
export function isExtensionEnabled(id: string): boolean {
  return !useExtensionEnablementStore.getState().disabledExtensionIds.includes(id)
}

// Mirrors store.ts's refreshWorkflows/vaultStatusStore's
// refreshVaultStatus shape: the one refetch path, callable from any
// surface (App.tsx's boot effect, the mill-data-changed router, the
// Extensions section's own toggle handler) without prop threading.
export function refreshDisabledExtensions(): Promise<void> {
  return SettingsService.GetDisabledExtensions()
    .then((ids) => useExtensionEnablementStore.getState().setDisabledExtensionIds(ids ?? []))
    .catch(console.error)
}
