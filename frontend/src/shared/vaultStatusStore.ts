import { create } from 'zustand'
import { BackupService, SecretService } from './bindings'
import type { VaultBackupTime, VaultStatus } from './bindings'
import { background } from './background'
import type { UserError } from './userError'

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
// It holds the failure's code and sentence rather than its text (goal
// 0339): the code is what the view branches on, and the sentence is the
// only part of a rejection that may reach the screen. null means "no
// outstanding failure".
interface VaultStatusState {
  vaultStatus: VaultStatus | null
  vaultError: UserError | null
  // The key-mismatch state's own "Last backup" fact (goal 0359): held
  // here, not view-local state, so secrets.restoreVaultFromBackup's own
  // enabled() predicate reads the identical truth synchronously the
  // palette/keyboard need, the same reason vaultStatus/vaultError
  // already live here rather than in SecretsView.tsx. null means "not
  // fetched for the current locked state yet"; Present=false once
  // fetched means no backup carries a vault.
  vaultBackupTime: VaultBackupTime | null
  setVaultStatus: (vaultStatus: VaultStatus) => void
  setVaultError: (vaultError: UserError | null) => void
  setVaultBackupTime: (vaultBackupTime: VaultBackupTime | null) => void
}

export const useVaultStatusStore = create<VaultStatusState>()((set) => ({
  vaultStatus: null,
  vaultError: null,
  vaultBackupTime: null,
  setVaultStatus: (vaultStatus) => set({ vaultStatus }),
  setVaultError: (vaultError) => set({ vaultError }),
  setVaultBackupTime: (vaultBackupTime) => set({ vaultBackupTime }),
}))

// Mirrors store.ts's refreshWorkflows/refreshRequests shape: the one
// refetch path, callable from any surface (App.tsx's boot effect and
// mill-data-changed router, SecretsView's own mount/event refresh,
// secrets.lockVault/unlockVault's own run()) without prop threading.
export function refreshVaultStatus(): Promise<void> {
  return background(SecretService.VaultStatus()
    .then((status) => useVaultStatusStore.getState().setVaultStatus(status)), 'vaultStatus.vaultStatus')
}

// refreshVaultBackupTime re-reads which backup (if any) currently
// carries a vault copy -- called whenever the locked view's own
// key-mismatch state becomes current, and after a restore attempt
// (goal 0359: a consumed backup drops off, so the caption/enablement
// must reflect the next-older one, or none left).
export function refreshVaultBackupTime(): Promise<void> {
  return background(BackupService.LatestVaultBackupTime()
    .then((t) => useVaultStatusStore.getState().setVaultBackupTime(t)), 'vaultStatus.vaultBackupTime')
}
