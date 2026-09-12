import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowseEntry, BrowseResult, InstallPreview, MarketplaceSource, PolicyView } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import type { CommandContext } from './commandContext'

const noticeMocks = vi.hoisted(() => ({ pushNotice: vi.fn() }))
const signalMocks = vi.hoisted(() => ({ notifyPluginRemoved: vi.fn() }))
vi.mock('./noticeStore', () => noticeMocks)
vi.mock('./pluginRemoveSignal', () => ({ ...signalMocks, onPluginRemoved: vi.fn(() => vi.fn()) }))
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({
  PluginService: {
    PreviewInstall: vi.fn(),
    InstallFromMarketplace: vi.fn(),
    BrowseMarketplaces: vi.fn(),
  },
}))

const { PluginService } = await import('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc')
const { findCommand, runCommand } = await import('./commands')
const { useExtensionMarketplaceInstallStore } = await import('./extensionMarketplaceInstallStore')
const { useExtensionSourcesStore } = await import('./extensionSourcesStore')
const { usePluginPolicyStore } = await import('./pluginPolicyStore')
const { useUISignalStore } = await import('./uiSignalStore')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const policy: PolicyView = {
  Version: 2, Managed: false, ManagedBy: '', RequiredTier: '', BlockedCapabilities: [], AllowedSources: [],
  SourceRules: [], LegacySourceRules: false, AllowCount: 0, BlockCount: 0, Path: '', Error: '',
}

function entry(overrides: Partial<BrowseEntry> = {}): BrowseEntry {
  return {
    Marketplace: 'source', Owner: '', ID: 'plugin', Name: 'Plugin', Description: '', Version: '1.0.0',
    Author: '', Kinds: [], Installed: false, Tier: 'verified', PolicyReason: '', ...overrides,
  }
}

function source(overrides: Partial<MarketplaceSource> = {}): MarketplaceSource {
  return {
    name: 'source', kind: 'path', locator: '/source', ref: '', addedAt: '',
    origin: { kind: 'path', locator: '/source', ref: '' }, incarnation: 'source-one', generation: 1,
    status: 'current', ...overrides,
  }
}

function browse(row = entry(), sourceRow = source()): BrowseResult {
  return { Entries: [row], Sources: [sourceRow], InstalledStateReady: true, InstalledStateError: '' }
}

function preview(overrides: Partial<InstallPreview> = {}): InstallPreview {
  return {
    ID: 'plugin', Name: 'Plugin', Version: '1.0.0', Author: '', Description: '', Marketplace: 'source',
    Tier: 'verified', Capabilities: [], NetworkHosts: [], AnyHost: false, Kinds: [], UsesSecrets: false,
    AlreadyInstalled: false, CanvasHost: false, PolicyRefusal: '', Warnings: [], ...overrides,
  }
}

const ctx: CommandContext = { kind: 'marketplaceEntry', marketplace: 'source', pluginId: 'plugin' }

beforeEach(() => {
  vi.clearAllMocks()
  usePluginPolicyStore.setState({ policy })
  useExtensionSourcesStore.setState({
    browse: browse(), browseLoading: false, browseError: '', browseReadRevision: 0,
  })
  useExtensionMarketplaceInstallStore.setState({
    target: null, preview: null, phase: 'idle', refusal: '', acknowledged: false,
    requestRevision: 0, ownerToken: null, nextOwnerToken: 0,
  })
  useUISignalStore.setState({ extensionInstalledRequest: 0 })
  vi.mocked(PluginService.PreviewInstall).mockResolvedValue(preview() as never)
  vi.mocked(PluginService.InstallFromMarketplace).mockResolvedValue(undefined as never)
  vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValue(browse() as never)
})

describe('marketplace install commands', () => {
  it('refuses missing, stale, unreadable, installed, blocked and pending rows before preview RPC', async () => {
    const command = findCommand('extension.browse.previewInstall')
    const wrong: CommandContext = { kind: 'marketplaceEntry', marketplace: 'source', pluginId: 'missing' }
    expect(command?.enabled?.(wrong)).toBe(false)
    expect(await runCommand('extension.browse.previewInstall', wrong)).toBe(false)

    usePluginPolicyStore.setState({ policy: null })
    expect(command?.enabled?.(ctx)).toBe(false)
    usePluginPolicyStore.setState({ policy: { ...policy, Error: 'unreadable' } })
    expect(command?.enabled?.(ctx)).toBe(false)
    usePluginPolicyStore.setState({ policy })
    useExtensionSourcesStore.setState({ browse: browse(entry({ Installed: true })) })
    expect(command?.enabled?.(ctx)).toBe(false)
    useExtensionSourcesStore.setState({ browse: browse(entry({ PolicyReason: 'blocked' })) })
    expect(command?.enabled?.(ctx)).toBe(false)
    useExtensionSourcesStore.setState({ browse: browse(), browseLoading: true })
    expect(command?.enabled?.(ctx)).toBe(false)
    useExtensionSourcesStore.setState({ browseLoading: false, browseError: 'read failed' })
    expect(command?.enabled?.(ctx)).toBe(false)
    useExtensionSourcesStore.setState({ browseError: '', browse: { ...browse(), InstalledStateReady: false } })
    expect(command?.enabled?.(ctx)).toBe(false)
    useExtensionSourcesStore.setState({ browse: { ...browse(), Sources: [] } })
    expect(command?.enabled?.(ctx)).toBe(false)
    useExtensionSourcesStore.setState({ browse: browse(entry(), source({ incarnation: '' })) })
    expect(command?.enabled?.(ctx)).toBe(false)
    useExtensionSourcesStore.setState({ browse: { ...browse(), Entries: [{ ...entry(), PolicyReason: undefined as never }] } })
    expect(command?.enabled?.(ctx)).toBe(true)
    expect(PluginService.PreviewInstall).not.toHaveBeenCalled()
  })

  it('opens one preview, gates unverified confirmation and refuses source replacement', async () => {
    const pending = deferred<InstallPreview>()
    vi.mocked(PluginService.PreviewInstall).mockReturnValueOnce(pending.promise as never)
    useExtensionMarketplaceInstallStore.getState().mountOwner()
    const first = runCommand('extension.browse.previewInstall', ctx)
    expect(await runCommand('extension.browse.previewInstall', ctx)).toBe(false)
    expect(PluginService.PreviewInstall).toHaveBeenCalledOnce()
    pending.resolve(preview({ Tier: 'unverified' }))
    expect(await first).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState().preview).not.toBeNull()
    expect(findCommand('extension.browse.confirmInstall')?.enabled?.(ctx)).toBe(false)
    useExtensionMarketplaceInstallStore.getState().setAcknowledged(true)
    expect(findCommand('extension.browse.confirmInstall')?.enabled?.(ctx)).toBe(true)
    useExtensionSourcesStore.setState({ browse: browse(entry(), source({ incarnation: 'source-two' })) })
    expect(findCommand('extension.browse.confirmInstall')?.enabled?.(ctx)).toBe(false)
    expect(await runCommand('extension.browse.confirmInstall', ctx)).toBe(false)
    expect(PluginService.InstallFromMarketplace).not.toHaveBeenCalled()
  })

  it('cancels a delayed preview and never reopens it', async () => {
    const pending = deferred<InstallPreview>()
    vi.mocked(PluginService.PreviewInstall).mockReturnValueOnce(pending.promise as never)
    const opening = runCommand('extension.browse.previewInstall', ctx)
    expect(findCommand('extension.browse.cancelInstall')?.enabled?.()).toBe(true)
    expect(await runCommand('extension.browse.cancelInstall')).toBe(true)
    pending.resolve(preview())
    expect(await opening).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState().preview).toBeNull()
  })

  it('suppresses a retired preview rejection at the command error boundary', async () => {
    const pending = deferred<InstallPreview>()
    vi.mocked(PluginService.PreviewInstall).mockReturnValueOnce(pending.promise as never)
    const opening = runCommand('extension.browse.previewInstall', ctx)
    expect(await runCommand('extension.browse.cancelInstall')).toBe(true)
    pending.reject(new Error('retired preview failed'))
    expect(await opening).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState().target).toBeNull()
    expect(noticeMocks.pushNotice).not.toHaveBeenCalled()
  })

  it('does not let an older rejection erase or report over a newer preview', async () => {
    const first = deferred<InstallPreview>()
    const second = deferred<InstallPreview>()
    vi.mocked(PluginService.PreviewInstall)
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never)
    const firstOpening = runCommand('extension.browse.previewInstall', ctx)
    await runCommand('extension.browse.cancelInstall')
    const secondOpening = runCommand('extension.browse.previewInstall', ctx)

    first.reject(new Error('old preview failed'))
    expect(await firstOpening).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState().phase).toBe('previewing')
    expect(useExtensionMarketplaceInstallStore.getState().target?.pluginId).toBe('plugin')
    expect(noticeMocks.pushNotice).not.toHaveBeenCalled()

    second.resolve(preview({ Version: '2.0.0' }))
    expect(await secondOpening).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState().preview?.Version).toBe('2.0.0')
  })

  it('reports the current preview rejection through the command error boundary', async () => {
    vi.mocked(PluginService.PreviewInstall).mockRejectedValueOnce(new Error('current preview failed') as never)
    expect(await runCommand('extension.browse.previewInstall', ctx)).toBe(false)
    expect(useExtensionMarketplaceInstallStore.getState().target).toBeNull()
    expect(noticeMocks.pushNotice).toHaveBeenCalledOnce()
  })

  it('keeps preview and policy refusal visible without installing', async () => {
    vi.mocked(PluginService.PreviewInstall).mockResolvedValueOnce(preview({ PolicyRefusal: 'blocked by policy' }) as never)
    expect(await runCommand('extension.browse.previewInstall', ctx)).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState().preview?.PolicyRefusal).toBe('blocked by policy')
    expect(await runCommand('extension.browse.confirmInstall', ctx)).toBe(false)
    expect(PluginService.InstallFromMarketplace).not.toHaveBeenCalled()
  })

  it('keeps an install refusal in the pending review for deliberate retry', async () => {
    vi.mocked(PluginService.InstallFromMarketplace).mockRejectedValueOnce({
      cause: { code: 'plugin-install-refused', message: 'package changed' },
    } as never)
    await runCommand('extension.browse.previewInstall', ctx)
    expect(await runCommand('extension.browse.confirmInstall', ctx)).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState().refusal).toBe('common:errors.plugin-install-refused')
    expect(useExtensionMarketplaceInstallStore.getState().preview).not.toBeNull()
    expect(findCommand('extension.browse.confirmInstall')?.enabled?.(ctx)).toBe(false)
  })

  it('installs once, clears state and signals the mounted Browse owner', async () => {
    const installation = deferred<void>()
    vi.mocked(PluginService.InstallFromMarketplace).mockReturnValueOnce(installation.promise as never)
    useExtensionMarketplaceInstallStore.getState().mountOwner()
    await runCommand('extension.browse.previewInstall', ctx)
    const installing = runCommand('extension.browse.confirmInstall', ctx)
    expect(await runCommand('extension.browse.confirmInstall', ctx)).toBe(false)
    expect(await runCommand('extension.browse.cancelInstall')).toBe(false)
    expect(PluginService.InstallFromMarketplace).toHaveBeenCalledOnce()
    installation.resolve()
    expect(await installing).toBe(true)
    expect(useExtensionMarketplaceInstallStore.getState().target).toBeNull()
    expect(signalMocks.notifyPluginRemoved).toHaveBeenCalledOnce()
    expect(useUISignalStore.getState().extensionInstalledRequest).toBe(1)
    expect(PluginService.BrowseMarketplaces).toHaveBeenCalledOnce()
    expect(noticeMocks.pushNotice).toHaveBeenCalledOnce()
  })

  it('does not redirect a newer Browse owner when an older owner installation finishes', async () => {
    const installation = deferred<void>()
    vi.mocked(PluginService.InstallFromMarketplace).mockReturnValueOnce(installation.promise as never)
    const oldOwner = useExtensionMarketplaceInstallStore.getState().mountOwner()
    await runCommand('extension.browse.previewInstall', ctx)
    const installing = runCommand('extension.browse.confirmInstall', ctx)
    useExtensionMarketplaceInstallStore.getState().retireOwner(oldOwner)
    useExtensionMarketplaceInstallStore.getState().mountOwner()
    installation.resolve()
    expect(await installing).toBe(true)
    expect(signalMocks.notifyPluginRemoved).toHaveBeenCalledOnce()
    expect(useUISignalStore.getState().extensionInstalledRequest).toBe(0)
  })
})
