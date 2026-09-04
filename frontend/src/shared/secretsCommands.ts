import type { Command } from './commands'
import { SecretService } from './bindings'
import { refreshVaultStatus, useVaultStatusStore } from './vaultStatusStore'
import type { UserError } from './userError'
import { userErrorFrom } from './userError'

// The vault lock/unlock/reset actions (goal 0222 S1's own state door,
// vaultStatusStore.ts) -- split out of shared/commands.ts (CLAUDE.md's
// 500-line convention), spread into its COMMANDS array. The view's own
// buttons call these (findCommand(id)?.run()) instead of their own
// SecretService calls, so a palette or keyboard invocation performs the
// exact same action. None needs input: any passphrase-equivalent lives
// behind the system authentication sheet, not a typed field.
//
// Every run() records its outcome in the store (goal 0330). A rejected
// unlock used to end in console.error, which left the Unlock button
// looking like it did nothing at all on a device whose stored key does
// not open the vault file.
function record(promise: Promise<unknown>): void {
  const { setVaultError } = useVaultStatusStore.getState()
  setVaultError(null)
  promise
    .then(refreshVaultStatus)
    .catch((err) => { setVaultError(userErrorFrom(err)) })
}

export const SECRETS_COMMANDS: Command[] = [
  {
    // The vault seat's anchor (goal 0335): its own `menu` fixes the
    // seat's File-menu position, but shared/menuSpec.ts's seatOverrides
    // (shared/vaultSeat.ts) decide which of lockVault/unlockVault
    // actually shows there and with what label/enablement.
    id: 'secrets.lockVault',
    menu: { path: 'file', group: 4, order: 0 },
    label: 'commands.secrets.lockVault',
    defaultBinding: null,
    enabled: () => useVaultStatusStore.getState().vaultStatus?.Unlocked === true,
    run: () => { record(SecretService.LockVault()) },
  },
  {
    id: 'secrets.unlockVault',
    label: 'commands.secrets.unlockVault',
    defaultBinding: null,
    enabled: () => {
      const status = useVaultStatusStore.getState().vaultStatus
      return status !== null && status.Exists && !status.Unlocked
    },
    run: () => { record(SecretService.UnlockVault()) },
  },
  {
    id: 'secrets.resetVault',
    label: 'commands.secrets.resetVault',
    defaultBinding: null,
    // Only offered where the current file cannot be opened at all --
    // the stored key does not fit it, or there is no key for it here.
    // Anywhere else this would discard a readable vault.
    enabled: () => {
      const { vaultStatus, vaultError } = useVaultStatusStore.getState()
      if (vaultStatus === null || !vaultStatus.Exists || vaultStatus.Unlocked) return false
      return vaultErrorKind(vaultError) === 'keyMismatch' || vaultErrorKind(vaultError) === 'noKey'
    },
    // Destructive, and only meaningful with the locked view's own
    // failure on screen to explain what it replaces.
    paletteHidden: true,
    run: () => { record(SecretService.ResetVault()) },
  },
]

// vaultErrorKind classifies a lock/unlock failure by the stable code
// the Go error declares (secretsvc's ErrKeyMismatch and friends). The
// code is what never changes; the wording stays on this side, where it
// can be translated, instead of being pinned to a Go sentence.
export type VaultErrorKind = 'keyMismatch' | 'noKey' | 'cancelled' | 'authUnavailable' | 'other' | 'none'

const KIND_FOR_CODE: Record<string, VaultErrorKind> = {
  'key-mismatch': 'keyMismatch',
  'no-vault-key': 'noKey',
  'unlock-cancelled': 'cancelled',
  'auth-unavailable': 'authUnavailable',
}

export function vaultErrorKind(error: UserError | null): VaultErrorKind {
  if (!error) return 'none'
  return KIND_FOR_CODE[error.code] ?? 'other'
}
