import { create } from 'zustand'
import { SecretService } from './bindings'
import type { VaultStatus } from './bindings'

// The vault-lock state door (goal 0222 S1): before this, whether the
// secrets vault was locked/unlocked existed only as local useState
// inside views/SecretsView.tsx, unreachable by anything outside that
// component -- shared/commands.ts's secrets.lockVault/unlockVault
// enablement predicates need to read the same truth synchronously, so
// it's lifted into its own store here, same "second store file, not
// more fields on store.ts" placement configureEntityStore.ts already
// established (CLAUDE.md's 500-line convention -- store.ts is already
// near it).
interface VaultStatusState {
  vaultStatus: VaultStatus | null
  setVaultStatus: (vaultStatus: VaultStatus) => void
}

export const useVaultStatusStore = create<VaultStatusState>()((set) => ({
  vaultStatus: null,
  setVaultStatus: (vaultStatus) => set({ vaultStatus }),
}))

// Mirrors store.ts's refreshWorkflows/refreshRequests shape: the one
// refetch path, callable from any surface (App.tsx's boot effect and
// mill-data-changed router, SecretsView's own mount/event refresh,
// secrets.lockVault/unlockVault's own run()) without prop threading.
export function refreshVaultStatus(): Promise<void> {
  return SecretService.VaultStatus()
    .then((status) => useVaultStatusStore.getState().setVaultStatus(status))
    .catch(console.error)
}
