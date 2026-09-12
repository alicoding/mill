import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowseResult, InstallCandidate, InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import type { CommandContext } from './commandContext'

const noticeMocks = vi.hoisted(() => ({ pushNotice: vi.fn() }))
const signalMocks = vi.hoisted(() => ({ notifyPluginRemoved: vi.fn() }))
vi.mock('./noticeStore', () => noticeMocks)
vi.mock('./pluginRemoveSignal', () => ({ ...signalMocks, onPluginRemoved: vi.fn(() => vi.fn()) }))
vi.mock('i18next', () => ({
  default: { t: (key: string, options?: { count?: number }) => options?.count === undefined ? key : `${key}:${options.count}` },
}))
vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({
  PluginService: {
    ReserveInstallPreparation: vi.fn(),
    PrepareInstall: vi.fn(),
    ConfirmInstall: vi.fn(),
    CancelInstallPreparation: vi.fn(),
    RecoverInstallations: vi.fn(),
    BrowseMarketplaces: vi.fn(),
    ListUpdates: vi.fn(),
  },
}))

const { PluginService } = await import('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc')
const { findCommand, runCommand } = await import('./commands')
const { useExtensionMarketplaceInstallStore } = await import('./extensionMarketplaceInstallStore')
const { useExtensionRecoveryStore } = await import('./extensionRecoveryStore')
const { useExtensionUpdatesStore } = await import('./extensionUpdatesStore')
const { useUISignalStore } = await import('./uiSignalStore')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function preview(overrides: Partial<InstallPreview> = {}): InstallPreview {
  return {
    ID: 'plugin', Name: 'Plugin', Version: '1.0.0', Author: '', Description: '', Marketplace: 'source',
    Tier: 'verified', Capabilities: [], NetworkHosts: [], AnyHost: false, NetworkGrantVersion: 1,
    NetworkMethods: {}, Kinds: [], UsesSecrets: false, AlreadyInstalled: false, CanvasHost: false,
    PolicyRefusal: '', Warnings: [], ...overrides,
  }
}

const candidate: InstallCandidate = {
  Kind: 'marketplace', Marketplace: 'source', Incarnation: 'source-one', ID: 'plugin', Version: '1.0.0',
  Locator: '', Encoded: '', Basename: '', DisplayName: '', Family: '',
}

const candidateContext: CommandContext = { kind: 'extensionInstallCandidate', candidate }
const emptyBrowse: BrowseResult = { Entries: [], Sources: [], InstalledStateReady: true, InstalledStateError: '' }

beforeEach(() => {
  vi.clearAllMocks()
  useExtensionMarketplaceInstallStore.setState({
    operationId: null, candidate: null, handle: '', expiresAt: '', preview: null, phase: 'idle', mode: 'install',
    visible: false, error: '', errorCode: '', retryable: false, acknowledged: false,
  })
  useExtensionUpdatesStore.setState({ bulkActive: false, canCancelRemaining: false, cancelRemaining: false, currentHandle: '', candidates: [], itemPhases: {} })
  useExtensionRecoveryStore.setState({ unresolved: false, retrying: false, detail: '' })
  useUISignalStore.setState({ extensionInstalledRequest: 0 })
  vi.mocked(PluginService.ReserveInstallPreparation).mockResolvedValue({ Handle: 'handle-one', ExpiresAt: '2099-01-01T00:00:00Z' } as never)
  vi.mocked(PluginService.PrepareInstall).mockResolvedValue({ Handle: 'handle-one', ExpiresAt: '2099-01-01T00:00:00Z', Preview: preview(), RequiresReview: true } as never)
  vi.mocked(PluginService.ConfirmInstall).mockResolvedValue({ Record: { version: '1.0.0' }, PluginID: 'plugin', NeedsAllow: true, CatalogWarningCode: '' } as never)
  vi.mocked(PluginService.CancelInstallPreparation).mockResolvedValue(undefined as never)
  vi.mocked(PluginService.RecoverInstallations).mockResolvedValue(undefined as never)
  vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValue(emptyBrowse as never)
  vi.mocked(PluginService.ListUpdates).mockResolvedValue({ checkedAt: '', candidates: [], problems: [] } as never)
})

describe('prepared extension install commands', () => {
  it('binds the selected source incarnation and staged preview to one attempt', async () => {
    expect(findCommand('extensions.install.prepare')?.enabled?.(candidateContext)).toBe(true)
    expect(await runCommand('extensions.install.prepare', candidateContext)).toBe(true)
    expect(PluginService.PrepareInstall).toHaveBeenCalledWith('handle-one', candidate)
    const state = useExtensionMarketplaceInstallStore.getState()
    expect(state.phase).toBe('ready')
    expect(state.preview?.ID).toBe('plugin')
    expect(state.operationId).not.toBeNull()
  })

  it('refuses locally mixed candidate shapes before reserving', async () => {
    const mixed: CommandContext = {
      kind: 'extensionInstallCandidate',
      candidate: { ...candidate, Locator: '/unexpected/local/path' },
    }
    expect(findCommand('extensions.install.prepare')?.enabled?.(mixed)).toBe(false)
    expect(await runCommand('extensions.install.prepare', mixed)).toBe(false)
    expect(PluginService.ReserveInstallPreparation).not.toHaveBeenCalled()
  })

  it('retires a cancelled generation before reservation returns', async () => {
    const reservation = deferred<{ Handle: string; ExpiresAt: string }>()
    vi.mocked(PluginService.ReserveInstallPreparation).mockReturnValueOnce(reservation.promise as never)
    const opening = runCommand('extensions.install.prepare', candidateContext)
    const operationId = useExtensionMarketplaceInstallStore.getState().operationId!
    expect(await runCommand('extensions.install.dismiss', { kind: 'extensionInstallAttempt', operationId })).toBe(true)
    reservation.resolve({ Handle: 'late-handle', ExpiresAt: '2099-01-01T00:00:00Z' })
    expect(await opening).toBe(true)
    expect(PluginService.CancelInstallPreparation).toHaveBeenCalledWith('late-handle')
    expect(PluginService.PrepareInstall).not.toHaveBeenCalled()
    expect(useExtensionMarketplaceInstallStore.getState().phase).toBe('idle')
  })

  it('cancels a known preparing handle and ignores a late prepared response', async () => {
    const prepared = deferred<unknown>()
    vi.mocked(PluginService.PrepareInstall).mockReturnValueOnce(prepared.promise as never)
    const opening = runCommand('extensions.install.prepare', candidateContext)
    await vi.waitFor(() => expect(useExtensionMarketplaceInstallStore.getState().phase).toBe('preparing'))
    const operationId = useExtensionMarketplaceInstallStore.getState().operationId!
    await runCommand('extensions.install.dismiss', { kind: 'extensionInstallAttempt', operationId })
    prepared.resolve({ Handle: 'handle-one', ExpiresAt: '2099-01-01T00:00:00Z', Preview: preview(), RequiresReview: true })
    expect(await opening).toBe(true)
    expect(PluginService.CancelInstallPreparation).toHaveBeenCalledWith('handle-one')
    expect(useExtensionMarketplaceInstallStore.getState().preview).toBeNull()
  })

  it('requires unverified acknowledgement and confirms the same handle once', async () => {
    vi.mocked(PluginService.PrepareInstall).mockResolvedValueOnce({
      Handle: 'handle-one', ExpiresAt: '2099-01-01T00:00:00Z', Preview: preview({ Tier: 'unverified' }), RequiresReview: true,
    } as never)
    await runCommand('extensions.install.prepare', candidateContext)
    const attempt: CommandContext = { kind: 'extensionInstallAttempt', operationId: useExtensionMarketplaceInstallStore.getState().operationId! }
    expect(findCommand('extensions.install.confirm')?.enabled?.(attempt)).toBe(false)
    useExtensionMarketplaceInstallStore.getState().setAcknowledged(true)
    expect(findCommand('extensions.install.confirm')?.enabled?.(attempt)).toBe(true)
    expect(await runCommand('extensions.install.confirm', attempt)).toBe(true)
    expect(PluginService.ConfirmInstall).toHaveBeenCalledTimes(1)
    expect(PluginService.ConfirmInstall).toHaveBeenCalledWith('handle-one')
    expect(useExtensionMarketplaceInstallStore.getState().phase).toBe('idle')
    expect(signalMocks.notifyPluginRemoved).toHaveBeenCalledOnce()
    expect(useUISignalStore.getState().extensionInstalledRequest).toBe(1)
  })

  it('keeps a retryable artifact-change refusal visible and prepares a new handle', async () => {
    vi.mocked(PluginService.PrepareInstall).mockRejectedValueOnce({
      cause: { code: 'install-candidate-changed', message: 'This extension offer changed.' },
    } as never)
    await runCommand('extensions.install.prepare', candidateContext)
    const first = useExtensionMarketplaceInstallStore.getState()
    const attempt: CommandContext = { kind: 'extensionInstallAttempt', operationId: first.operationId! }
    expect(first.phase).toBe('error')
    expect(first.retryable).toBe(true)
    vi.mocked(PluginService.ReserveInstallPreparation).mockResolvedValueOnce({ Handle: 'handle-two', ExpiresAt: '2099-01-01T00:00:00Z' } as never)
    vi.mocked(PluginService.PrepareInstall).mockResolvedValueOnce({ Handle: 'handle-two', ExpiresAt: '2099-01-01T00:00:00Z', Preview: preview(), RequiresReview: true } as never)
    expect(await runCommand('extensions.install.retry', attempt)).toBe(true)
    expect(PluginService.PrepareInstall).toHaveBeenLastCalledWith('handle-two', candidate)
    expect(useExtensionMarketplaceInstallStore.getState().phase).toBe('ready')
  })

  it('disables confirmation and retry while recovery or bulk mutation is unresolved', async () => {
    await runCommand('extensions.install.prepare', candidateContext)
    const readyAttempt: CommandContext = { kind: 'extensionInstallAttempt', operationId: useExtensionMarketplaceInstallStore.getState().operationId! }
    useExtensionRecoveryStore.getState().require('kept files')
    expect(findCommand('extensions.install.confirm')?.enabled?.(readyAttempt)).toBe(false)

    useExtensionRecoveryStore.setState({ unresolved: false, detail: '' })
    useExtensionMarketplaceInstallStore.setState({ phase: 'error', retryable: true })
    useExtensionUpdatesStore.setState({ bulkActive: true })
    expect(findCommand('extensions.install.retry')?.enabled?.(readyAttempt)).toBe(false)
  })

  it('counts a committed cleanup failure as installed and blocks another mutation for recovery', async () => {
    vi.mocked(PluginService.ConfirmInstall).mockResolvedValueOnce({
      Record: { version: '1.0.0' }, PluginID: 'plugin', NeedsAllow: true, CatalogWarningCode: '', RecoveryRequired: true,
    } as never)
    await runCommand('extensions.install.prepare', candidateContext)
    const attempt: CommandContext = { kind: 'extensionInstallAttempt', operationId: useExtensionMarketplaceInstallStore.getState().operationId! }
    expect(await runCommand('extensions.install.confirm', attempt)).toBe(true)
    expect(useExtensionRecoveryStore.getState().unresolved).toBe(true)
    expect(signalMocks.notifyPluginRemoved).toHaveBeenCalledOnce()
    expect(noticeMocks.pushNotice).toHaveBeenCalledWith(expect.objectContaining({ level: 'success' }))
    expect(noticeMocks.pushNotice).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }))
    expect(findCommand('extensions.install.prepare')?.enabled?.(candidateContext)).toBe(false)
  })

  it('stops a bulk batch after an installed result requires recovery', async () => {
    useExtensionUpdatesStore.setState({
      candidates: [
        { ID: 'first', Name: 'First', Installed: '1.0.0', Available: '2.0.0' },
        { ID: 'second', Name: 'Second', Installed: '1.0.0', Available: '2.0.0' },
      ] as never,
    })
    vi.mocked(PluginService.PrepareInstall).mockResolvedValueOnce({
      Handle: 'handle-one', ExpiresAt: '2099-01-01T00:00:00Z', Preview: preview({ ID: 'first' }), RequiresReview: false,
    } as never)
    vi.mocked(PluginService.ConfirmInstall).mockResolvedValueOnce({
      Record: { version: '2.0.0' }, PluginID: 'first', NeedsAllow: false, CatalogWarningCode: '', RecoveryRequired: true,
    } as never)
    expect(await runCommand('extensions.updateAll')).toBe(true)
    await vi.waitFor(() => expect(useExtensionUpdatesStore.getState().bulkActive).toBe(false))
    expect(PluginService.PrepareInstall).toHaveBeenCalledTimes(1)
    expect(useExtensionUpdatesStore.getState().itemPhases).toMatchObject({ first: 'updated', second: 'recovery-blocked' })
    expect(useExtensionRecoveryStore.getState().unresolved).toBe(true)
    expect(PluginService.ListUpdates).not.toHaveBeenCalled()
    expect(noticeMocks.pushNotice).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error', text: expect.stringContaining('views:extensions.updates.bulkRecoveryBlocked'),
    }))
  })

  it('marks a thrown recovery failure as failed and only later items as recovery-blocked', async () => {
    useExtensionUpdatesStore.setState({
      candidates: [
        { ID: 'first', Name: 'First', Installed: '1.0.0', Available: '2.0.0' },
        { ID: 'second', Name: 'Second', Installed: '1.0.0', Available: '2.0.0' },
      ] as never,
    })
    vi.mocked(PluginService.PrepareInstall).mockRejectedValueOnce({
      cause: { code: 'install-recovery-required', message: 'Recovery needed.' },
    } as never)
    expect(await runCommand('extensions.updateAll')).toBe(true)
    await vi.waitFor(() => expect(useExtensionUpdatesStore.getState().bulkActive).toBe(false))
    expect(useExtensionUpdatesStore.getState().itemPhases).toMatchObject({ first: 'failed', second: 'recovery-blocked' })
    expect(PluginService.ReserveInstallPreparation).toHaveBeenCalledTimes(1)
    expect(PluginService.PrepareInstall).toHaveBeenCalledTimes(1)
    expect(PluginService.ConfirmInstall).not.toHaveBeenCalled()
    expect(noticeMocks.pushNotice).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error', text: expect.stringContaining('views:extensions.updates.bulkRecoveryBlocked'),
    }))
  })

  it('reconciles every candidate into one of the five bulk summary counts', async () => {
    useExtensionUpdatesStore.setState({
      candidates: [
        { ID: 'updated', Name: 'Updated', Installed: '1.0.0', Available: '2.0.0' },
        { ID: 'review', Name: 'Review', Installed: '1.0.0', Available: '2.0.0' },
        { ID: 'failed', Name: 'Failed', Installed: '1.0.0', Available: '2.0.0' },
        { ID: 'blocked', Name: 'Blocked', Installed: '1.0.0', Available: '2.0.0' },
      ] as never,
    })
    vi.mocked(PluginService.PrepareInstall)
      .mockResolvedValueOnce({
        Handle: 'handle-updated', ExpiresAt: '2099-01-01T00:00:00Z', Preview: preview({ ID: 'updated' }), RequiresReview: false,
      } as never)
      .mockResolvedValueOnce({
        Handle: 'handle-review', ExpiresAt: '2099-01-01T00:00:00Z', Preview: preview({ ID: 'review' }), RequiresReview: true,
      } as never)
      .mockRejectedValueOnce({ cause: { code: 'install-recovery-required', message: 'Recovery needed.' } } as never)
    vi.mocked(PluginService.ConfirmInstall).mockResolvedValueOnce({
      Record: { version: '2.0.0' }, PluginID: 'updated', NeedsAllow: false, CatalogWarningCode: '', RecoveryRequired: false,
    } as never)

    expect(await runCommand('extensions.updateAll')).toBe(true)
    await vi.waitFor(() => expect(useExtensionUpdatesStore.getState().bulkActive).toBe(false))

    const phases = useExtensionUpdatesStore.getState().itemPhases
    expect(phases).toEqual({ updated: 'updated', review: 'needs-review', failed: 'failed', blocked: 'recovery-blocked' })
    expect(Object.keys(phases)).toHaveLength(4)
    expect(PluginService.ReserveInstallPreparation).toHaveBeenCalledTimes(3)
    expect(PluginService.PrepareInstall).toHaveBeenCalledTimes(3)
    expect(PluginService.ConfirmInstall).toHaveBeenCalledTimes(1)
    const summary = noticeMocks.pushNotice.mock.calls
      .map(([notice]) => notice as { text: string })
      .find((notice) => notice.text.includes('views:extensions.updates.bulkRecoveryBlocked'))
    expect(summary?.text).toBe([
      'views:extensions.updates.bulkUpdated:1',
      'views:extensions.updates.bulkNeedsReview:1',
      'views:extensions.updates.bulkFailed:1',
      'views:extensions.updates.bulkRecoveryBlocked:1',
    ].join(' '))
  })

  it('cancels remaining bulk items without cancelling a committing item', async () => {
    useExtensionUpdatesStore.setState({
      candidates: [
        { ID: 'first', Name: 'First', Installed: '1.0.0', Available: '2.0.0' },
        { ID: 'second', Name: 'Second', Installed: '1.0.0', Available: '2.0.0' },
      ] as never,
    })
    vi.mocked(PluginService.PrepareInstall).mockResolvedValueOnce({
      Handle: 'handle-one', ExpiresAt: '2099-01-01T00:00:00Z', Preview: preview({ ID: 'first' }), RequiresReview: false,
    } as never)
    const committing = deferred<unknown>()
    vi.mocked(PluginService.ConfirmInstall).mockReturnValueOnce(committing.promise as never)
    expect(await runCommand('extensions.updateAll')).toBe(true)
    await vi.waitFor(() => expect(useExtensionUpdatesStore.getState().itemPhases.first).toBe('updating'))
    expect(findCommand('extensions.cancelRemainingUpdates')?.enabled?.()).toBe(true)
    expect(await runCommand('extensions.cancelRemainingUpdates')).toBe(true)
    expect(PluginService.CancelInstallPreparation).not.toHaveBeenCalled()
    committing.resolve({ Record: { version: '2.0.0' }, PluginID: 'first', NeedsAllow: false, CatalogWarningCode: '', RecoveryRequired: false })
    await vi.waitFor(() => expect(useExtensionUpdatesStore.getState().bulkActive).toBe(false))
    expect(useExtensionUpdatesStore.getState().itemPhases.second).toBe('cancelled')
  })

  it('gives recovery precedence when cancellation arrives during a recovering commit', async () => {
    useExtensionUpdatesStore.setState({
      candidates: [
        { ID: 'first', Name: 'First', Installed: '1.0.0', Available: '2.0.0' },
        { ID: 'second', Name: 'Second', Installed: '1.0.0', Available: '2.0.0' },
      ] as never,
    })
    vi.mocked(PluginService.PrepareInstall).mockResolvedValueOnce({
      Handle: 'handle-one', ExpiresAt: '2099-01-01T00:00:00Z', Preview: preview({ ID: 'first' }), RequiresReview: false,
    } as never)
    const committing = deferred<unknown>()
    vi.mocked(PluginService.ConfirmInstall).mockReturnValueOnce(committing.promise as never)
    expect(await runCommand('extensions.updateAll')).toBe(true)
    await vi.waitFor(() => expect(useExtensionUpdatesStore.getState().itemPhases.first).toBe('updating'))
    expect(await runCommand('extensions.cancelRemainingUpdates')).toBe(true)
    committing.resolve({ Record: { version: '2.0.0' }, PluginID: 'first', NeedsAllow: false, CatalogWarningCode: '', RecoveryRequired: true })
    await vi.waitFor(() => expect(useExtensionUpdatesStore.getState().bulkActive).toBe(false))
    expect(useExtensionUpdatesStore.getState().itemPhases).toMatchObject({ first: 'updated', second: 'recovery-blocked' })
    expect(PluginService.ReserveInstallPreparation).toHaveBeenCalledTimes(1)
  })

  it('retries recovery and reloads only local catalog state', async () => {
    useExtensionRecoveryStore.getState().require('kept files')
    useExtensionUpdatesStore.setState({ itemPhases: { first: 'updated', second: 'recovery-blocked' } })
    expect(findCommand('extensions.retryRecovery')?.enabled?.()).toBe(true)

    expect(await runCommand('extensions.retryRecovery')).toBe(true)

    expect(PluginService.RecoverInstallations).toHaveBeenCalledOnce()
    expect(PluginService.ReserveInstallPreparation).not.toHaveBeenCalled()
    expect(PluginService.PrepareInstall).not.toHaveBeenCalled()
    expect(PluginService.ConfirmInstall).not.toHaveBeenCalled()
    expect(PluginService.BrowseMarketplaces).not.toHaveBeenCalled()
    expect(PluginService.ListUpdates).toHaveBeenCalledOnce()
    expect(useExtensionRecoveryStore.getState()).toMatchObject({ unresolved: false, retrying: false, detail: '' })
    expect(useExtensionUpdatesStore.getState().itemPhases).toEqual({ first: 'updated' })
    expect(signalMocks.notifyPluginRemoved).toHaveBeenCalledOnce()
  })

  it('keeps recovery-blocked rows when recovery or the authoritative reload fails', async () => {
    for (const failure of ['recovery', 'reload']) {
      vi.clearAllMocks()
      useExtensionRecoveryStore.setState({ unresolved: true, retrying: false, detail: 'kept files' })
      useExtensionUpdatesStore.setState({ bulkActive: false, itemPhases: { second: 'recovery-blocked' } })
      if (failure === 'recovery') {
        vi.mocked(PluginService.RecoverInstallations).mockRejectedValueOnce(new Error('recovery still blocked'))
      } else {
        vi.mocked(PluginService.RecoverInstallations).mockResolvedValueOnce(undefined as never)
        vi.mocked(PluginService.ListUpdates).mockRejectedValueOnce(new Error('update list unreadable'))
      }
      expect(await runCommand('extensions.retryRecovery')).toBe(failure === 'reload')
      expect(useExtensionUpdatesStore.getState().itemPhases.second).toBe('recovery-blocked')
    }
  })

  it('keeps a committing result owner after Close and reports a late failure without reopening', async () => {
    await runCommand('extensions.install.prepare', candidateContext)
    const attempt: CommandContext = { kind: 'extensionInstallAttempt', operationId: useExtensionMarketplaceInstallStore.getState().operationId! }
    const committing = deferred<unknown>()
    vi.mocked(PluginService.ConfirmInstall).mockReturnValueOnce(committing.promise as never)
    const confirmation = runCommand('extensions.install.confirm', attempt)
    await vi.waitFor(() => expect(useExtensionMarketplaceInstallStore.getState().phase).toBe('committing'))
    expect(await runCommand('extensions.install.dismiss', attempt)).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState().visible).toBe(false)

    committing.reject(new Error('injected placement failure'))
    expect(await confirmation).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState()).toMatchObject({ phase: 'idle', visible: false, operationId: null })
    expect(noticeMocks.pushNotice).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }))
  })
})
