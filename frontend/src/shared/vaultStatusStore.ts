import { create } from 'zustand'
import { SecretService } from './bindings'
import type { VaultStatus } from './bindings'
import { background } from './background'

// The vault-lock state door (goal 0222 S1): before this, whether the
// secrets vault was locked/unlocked existed only as local useState
// inside views/SecretsView.tsx, unreachable by anything outside that
// component -- shared/commands.ts's secrets.lockVault/unlockVault
// enablement predicates need to read the same truth synchronously, so
// it's lifted into its own store here, same "second store file, not
// more fields on store.ts" placement configureEntityStore.ts already
// established (CLAUDE.md's 500-line convention -- store.ts is already
// near it).
// vaultError carries the LAST lock/unlock outcome (goal 0330): a
// command's run() returns void, so the surface that renders the failure
// cannot await it. Before this, secretsCommands.ts swallowed the
// rejection into console.error and the Unlock button looked inert.
// Empty string means "no outstanding failure".
interface VaultStatusState {
  vaultStatus: VaultStatus | null
  vaultError: string
  setVaultStatus: (vaultStatus: VaultStatus) => void
  setVaultError: (vaultError: string) => void
}

export const useVaultStatusStore = create<VaultStatusState>()((set) => ({
  vaultStatus: null,
  vaultError: '',
  setVaultStatus: (vaultStatus) => set({ vaultStatus }),
  setVaultError: (vaultError) => set({ vaultError }),
}))

// Mirrors store.ts's refreshWorkflows/refreshRequests shape: the one
// refetch path, callable from any surface (App.tsx's boot effect and
// mill-data-changed router, SecretsView's own mount/event refresh,
// secrets.lockVault/unlockVault's own run()) without prop threading.
export function refreshVaultStatus(): Promise<void> {
  return background(SecretService.VaultStatus()
    .then((status) => useVaultStatusStore.getState().setVaultStatus(status)), 'vaultStatus.vaultStatus')
}
