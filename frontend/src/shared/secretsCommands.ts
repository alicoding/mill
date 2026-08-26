import type { Command } from './commands'
import { SecretService } from './bindings'
import { refreshVaultStatus, useVaultStatusStore } from './vaultStatusStore'

// The vault lock/unlock actions (goal 0222 S1's own new state door,
// vaultStatusStore.ts) -- split out of shared/commands.ts (CLAUDE.md's
// 500-line convention), spread into its COMMANDS array. Both were
// SecretsView.tsx-only onClick handlers before this; the view's own
// Lock/Unlock buttons now call these directly (findCommand(id)?.run())
// instead of their own SecretService calls, so a future palette/
// keyboard invocation performs the exact same action. Neither call
// needs input (UnlockVault/LockVault take no arguments -- any
// passphrase-equivalent lives behind Touch ID/keychain, not a typed
// field), so a direct service call is the whole implementation, same
// shape backup.now/panel.applyClipboard already use.
export const SECRETS_COMMANDS: Command[] = [
  {
    id: 'secrets.lockVault',
    label: 'Lock vault',
    defaultBinding: null,
    enabled: () => useVaultStatusStore.getState().vaultStatus?.Unlocked === true,
    run: () => { SecretService.LockVault().then(refreshVaultStatus).catch(console.error) },
  },
  {
    id: 'secrets.unlockVault',
    label: 'Unlock vault',
    defaultBinding: null,
    enabled: () => {
      const status = useVaultStatusStore.getState().vaultStatus
      return status !== null && status.Exists && !status.Unlocked
    },
    run: () => { SecretService.UnlockVault().then(refreshVaultStatus).catch(console.error) },
  },
]
