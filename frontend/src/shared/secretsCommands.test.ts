import { beforeEach, describe, expect, it } from 'vitest'
import { vaultErrorKind } from './secretsCommands'
import { findCommand } from './commands'
import { useVaultStatusStore } from './vaultStatusStore'

// An unlock that fails has to reach the surface as one of a fixed set
// of outcomes (goal 0330). The Go side declares a stable code precisely
// so the wording lives here; these pin that classification, and the
// enablement predicate that decides whether the destructive door is
// offered at all.
describe('vaultErrorKind', () => {
  it('classifies each outcome by its stable code', () => {
    expect(vaultErrorKind({ code: 'key-mismatch', message: "The key on this device doesn't open this vault file." })).toBe('keyMismatch')
    expect(vaultErrorKind({ code: 'no-vault-key', message: "There's no key for this vault on this device." })).toBe('noKey')
    expect(vaultErrorKind({ code: 'unlock-cancelled', message: 'Unlock cancelled.' })).toBe('cancelled')
    expect(vaultErrorKind({ code: 'auth-unavailable', message: "Touch ID or a password isn't set up on this Mac." })).toBe('authUnavailable')
  })

  it('keeps an unrecognised failure visible instead of classifying it away', () => {
    expect(vaultErrorKind({ code: 'unexpected', message: 'Something went wrong. Try again.' })).toBe('other')
  })

  it('reports no outcome at all when nothing has failed', () => {
    expect(vaultErrorKind(null)).toBe('none')
  })
})

describe('secrets.resetVault enablement', () => {
  beforeEach(() => {
    useVaultStatusStore.getState().setVaultError(null)
  })

  const enabled = () => findCommand('secrets.resetVault')?.enabled?.() ?? false

  it('is offered only for a locked vault this device cannot open', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: false, AuthAvailable: false })
    useVaultStatusStore.getState().setVaultError({ code: 'no-vault-key', message: "There's no key for this vault on this device." })
    expect(enabled()).toBe(true)

    useVaultStatusStore.getState().setVaultError({ code: 'key-mismatch', message: "The key on this device doesn't open this vault file." })
    expect(enabled()).toBe(true)
  })

  it('is not offered for a cancelled unlock -- the key is fine, the person just stepped away', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: true, AuthAvailable: true })
    useVaultStatusStore.getState().setVaultError({ code: 'unlock-cancelled', message: 'Unlock cancelled.' })
    expect(enabled()).toBe(false)
  })

  it('is never offered before an unlock has failed, or once the vault is open', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: false, AuthAvailable: false })
    expect(enabled()).toBe(false)

    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: true, RequireAuth: false, AuthAvailable: false })
    useVaultStatusStore.getState().setVaultError({ code: 'key-mismatch', message: "The key on this device doesn't open this vault file." })
    expect(enabled()).toBe(false)
  })

  it('stays out of the palette -- it needs the locked view to explain what it replaces', () => {
    expect(findCommand('secrets.resetVault')?.paletteHidden).toBe(true)
  })
})

describe('secrets.restoreVaultFromBackup enablement', () => {
  beforeEach(() => {
    useVaultStatusStore.getState().setVaultError(null)
    useVaultStatusStore.getState().setVaultBackupTime(null)
  })

  const enabled = () => findCommand('secrets.restoreVaultFromBackup')?.enabled?.() ?? false

  it('is offered only for a key-mismatch lock with a backup that carries a vault', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: false, AuthAvailable: false })
    useVaultStatusStore.getState().setVaultError({ code: 'key-mismatch', message: "The key on this device doesn't open this vault file." })
    useVaultStatusStore.getState().setVaultBackupTime({ time: '2026-09-04T10:00:00Z', present: true })
    expect(enabled()).toBe(true)
  })

  it('is not offered when no backup carries a vault', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: false, AuthAvailable: false })
    useVaultStatusStore.getState().setVaultError({ code: 'key-mismatch', message: "The key on this device doesn't open this vault file." })
    useVaultStatusStore.getState().setVaultBackupTime({ time: '', present: false })
    expect(enabled()).toBe(false)
  })

  it('is not offered for a no-vault-key lock, even with a backup available -- that door is a fresh empty vault, not a swap', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: false, AuthAvailable: false })
    useVaultStatusStore.getState().setVaultError({ code: 'no-vault-key', message: "There's no key for this vault on this device." })
    useVaultStatusStore.getState().setVaultBackupTime({ time: '2026-09-04T10:00:00Z', present: true })
    expect(enabled()).toBe(false)
  })

  it('is never offered once the vault is open', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: true, RequireAuth: false, AuthAvailable: false })
    useVaultStatusStore.getState().setVaultError({ code: 'key-mismatch', message: "The key on this device doesn't open this vault file." })
    useVaultStatusStore.getState().setVaultBackupTime({ time: '2026-09-04T10:00:00Z', present: true })
    expect(enabled()).toBe(false)
  })

  it('is offered in the palette', () => {
    expect(findCommand('secrets.restoreVaultFromBackup')?.paletteHidden).toBeFalsy()
  })
})
