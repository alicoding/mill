import { describe, expect, it } from 'vitest'
import { vaultSeatFor } from './vaultSeat'
import type { VaultStatus } from './bindings'

function status(partial: Partial<VaultStatus>): VaultStatus {
  return { Exists: true, Unlocked: false, ...partial } as VaultStatus
}

describe('vaultSeatFor (the vault menu seat, goal 0335)', () => {
  it('offers to lock once the vault is unlocked', () => {
    expect(vaultSeatFor(status({ Unlocked: true }))).toEqual({
      commandId: 'secrets.lockVault', label: 'Lock vault', enabled: true,
    })
  })

  it('offers to unlock an existing, locked vault', () => {
    expect(vaultSeatFor(status({ Unlocked: false, Exists: true }))).toEqual({
      commandId: 'secrets.unlockVault', label: 'Unlock vault', enabled: true,
    })
  })

  it('disables Unlock vault when there is no vault file yet', () => {
    expect(vaultSeatFor(status({ Unlocked: false, Exists: false }))).toEqual({
      commandId: 'secrets.unlockVault', label: 'Unlock vault', enabled: false,
    })
  })

  it('disables Unlock vault before the status is known at all', () => {
    expect(vaultSeatFor(null)).toEqual({
      commandId: 'secrets.unlockVault', label: 'Unlock vault', enabled: false,
    })
  })
})
