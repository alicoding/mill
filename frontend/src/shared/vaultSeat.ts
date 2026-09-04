import type { SeatOverride } from './menuSpec'
import type { VaultStatus } from './bindings'

// The vault seat's own state -> {command, label, enabled} table (goal
// 0335), the same one-seat-follows-state shape shared/updateSeat.ts
// uses: File shows "Lock vault" once the vault is open and "Unlock
// vault" once it's closed, never both at once. Pure -- shared/
// menuBridge.ts is the one caller.
export function vaultSeatFor(status: VaultStatus | null): SeatOverride {
  if (status?.Unlocked) return { commandId: 'secrets.lockVault', label: 'Lock vault', enabled: true }
  return { commandId: 'secrets.unlockVault', label: 'Unlock vault', enabled: status !== null && status.Exists }
}
