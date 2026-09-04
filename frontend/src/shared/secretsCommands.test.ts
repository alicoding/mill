import { beforeEach, describe, expect, it } from 'vitest'
import { vaultErrorKind } from './secretsCommands'
import { findCommand } from './commands'
import { useVaultStatusStore } from './vaultStatusStore'

// Goal 0330: an unlock that fails has to reach the surface as one of a
// fixed set of outcomes. The Go side carries a stable token in its
// error text precisely so the wording lives here; these pin that
// classification, and the enablement predicate that decides whether the
// destructive door is offered at all.
describe('vaultErrorKind', () => {
  it('classifies each outcome by its stable token, whatever wraps it', () => {
    expect(vaultErrorKind('RuntimeError: key-mismatch: the stored key does not open this vault file')).toBe('keyMismatch')
    expect(vaultErrorKind('RuntimeError: no-vault-key: no key for this vault is stored on this device')).toBe('noKey')
    expect(vaultErrorKind('RuntimeError: unlock-cancelled: authentication was not completed')).toBe('cancelled')
    expect(vaultErrorKind('RuntimeError: auth-unavailable: no Touch ID or password authentication is set up on this Mac')).toBe('authUnavailable')
  })

  it('keeps an unrecognised failure visible instead of classifying it away', () => {
    expect(vaultErrorKind('RuntimeError: reading vault key: some other problem')).toBe('other')
  })

  it('reports no outcome at all for an empty error', () => {
    expect(vaultErrorKind('')).toBe('none')
  })
})

describe('secrets.resetVault enablement', () => {
  beforeEach(() => {
    useVaultStatusStore.getState().setVaultError('')
  })

  const enabled = () => findCommand('secrets.resetVault')?.enabled?.() ?? false

  it('is offered only for a locked vault this device cannot open', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: false, AuthAvailable: false })
    useVaultStatusStore.getState().setVaultError('no-vault-key: no key for this vault is stored on this device')
    expect(enabled()).toBe(true)

    useVaultStatusStore.getState().setVaultError('key-mismatch: the stored key does not open this vault file')
    expect(enabled()).toBe(true)
  })

  it('is not offered for a cancelled unlock -- the key is fine, the person just stepped away', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: true, AuthAvailable: true })
    useVaultStatusStore.getState().setVaultError('unlock-cancelled: authentication was not completed')
    expect(enabled()).toBe(false)
  })

  it('is never offered before an unlock has failed, or once the vault is open', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: false, AuthAvailable: false })
    expect(enabled()).toBe(false)

    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: true, RequireAuth: false, AuthAvailable: false })
    useVaultStatusStore.getState().setVaultError('key-mismatch: the stored key does not open this vault file')
    expect(enabled()).toBe(false)
  })

  it('stays out of the palette -- it needs the locked view to explain what it replaces', () => {
    expect(findCommand('secrets.resetVault')?.paletteHidden).toBe(true)
  })
})
