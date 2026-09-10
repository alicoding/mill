import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowseResult, MarketplaceSource } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({
  PluginService: {
    AddMarketplaceSource: vi.fn(),
    BrowseMarketplaces: vi.fn(),
    ListMarketplaceSources: vi.fn(),
    RefreshMarketplaceSources: vi.fn(),
    RemoveMarketplaceSource: vi.fn(),
  },
}))

const { PluginService } = await import('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc')
const { useExtensionSourcesStore } = await import('./extensionSourcesStore')

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function source(name: string, incarnation: string): MarketplaceSource {
  return {
    name, kind: 'path', locator: `/sources/${name}`, ref: '', addedAt: '',
    origin: { kind: 'path', locator: `/sources/${name}`, ref: '' }, incarnation,
    generation: 0, status: 'current',
  }
}

function browse(label: string): BrowseResult {
  return {
    Entries: [{
      Marketplace: 'source', Owner: '', ID: label, Name: label, Description: '', Version: '1.0.0',
      Author: '', Kinds: [], Installed: false, Tier: 'unverified', PolicyReason: '',
    }],
    Sources: [], InstalledStateReady: true, InstalledStateError: '',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useExtensionSourcesStore.setState({
    sources: [], ready: false, loading: false, error: '', mutation: null,
    completionRevision: 0, confirmedIncarnation: '', readRevision: 0,
    browse: null, browseLoading: false, browseError: '', browseReadRevision: 0,
    browseQuery: '', browseKinds: [],
  })
})

describe('extensionSourcesStore', () => {
  it('accepts only the latest local source and Browse reads', async () => {
    const firstSources = deferred<MarketplaceSource[]>()
    const secondSources = deferred<MarketplaceSource[]>()
    vi.mocked(PluginService.ListMarketplaceSources)
      .mockReturnValueOnce(firstSources.promise as never)
      .mockReturnValueOnce(secondSources.promise as never)
    const oldSourceRead = useExtensionSourcesStore.getState().load()
    const newSourceRead = useExtensionSourcesStore.getState().load()
    secondSources.resolve([source('new', 'new-incarnation')])
    await newSourceRead
    firstSources.resolve([source('old', 'old-incarnation')])
    await oldSourceRead
    expect(useExtensionSourcesStore.getState().sources.map((item) => item.name)).toEqual(['new'])

    const firstBrowse = deferred<BrowseResult>()
    const secondBrowse = deferred<BrowseResult>()
    vi.mocked(PluginService.BrowseMarketplaces)
      .mockReturnValueOnce(firstBrowse.promise as never)
      .mockReturnValueOnce(secondBrowse.promise as never)
    const oldBrowseRead = useExtensionSourcesStore.getState().loadBrowse()
    const newBrowseRead = useExtensionSourcesStore.getState().loadBrowse()
    secondBrowse.resolve(browse('new'))
    await newBrowseRead
    firstBrowse.reject(new Error('stale failure'))
    await oldBrowseRead
    expect(useExtensionSourcesStore.getState().browse?.Entries?.[0].ID).toBe('new')
    expect(useExtensionSourcesStore.getState().browseError).toBe('')
  })

  it('shares mutation exclusion and releases it after success or failure', async () => {
    const pendingAdd = deferred<MarketplaceSource>()
    vi.mocked(PluginService.AddMarketplaceSource).mockReturnValueOnce(pendingAdd.promise as never)
    const add = useExtensionSourcesStore.getState().add('/source')
    expect(useExtensionSourcesStore.getState().mutation).toBe('add')
    await expect(useExtensionSourcesStore.getState().refresh()).rejects.toThrow('already in progress')
    expect(PluginService.RefreshMarketplaceSources).not.toHaveBeenCalled()
    pendingAdd.resolve(source('added', 'one'))
    await add
    expect(useExtensionSourcesStore.getState().mutation).toBeNull()
    expect(useExtensionSourcesStore.getState().completionRevision).toBe(1)

    vi.mocked(PluginService.RefreshMarketplaceSources).mockRejectedValueOnce(new Error('refresh failed'))
    await expect(useExtensionSourcesStore.getState().refresh()).rejects.toThrow('refresh failed')
    expect(useExtensionSourcesStore.getState().mutation).toBeNull()
    expect(useExtensionSourcesStore.getState().completionRevision).toBe(2)
  })

  it('keeps filters while a failed source read is recovered', async () => {
    useExtensionSourcesStore.getState().setBrowseQuery('draft')
    useExtensionSourcesStore.getState().setBrowseKinds(['tools'])
    vi.mocked(PluginService.BrowseMarketplaces)
      .mockRejectedValueOnce(new Error('unreadable'))
      .mockResolvedValueOnce(browse('recovered') as never)
    await expect(useExtensionSourcesStore.getState().loadBrowse()).resolves.toBe(false)
    await expect(useExtensionSourcesStore.getState().loadBrowse()).resolves.toBe(true)
    expect(useExtensionSourcesStore.getState().browseQuery).toBe('draft')
    expect(useExtensionSourcesStore.getState().browseKinds).toEqual(['tools'])
  })

  it('retains an accepted Browse result across a failed reload and replaces it on Retry', async () => {
    vi.mocked(PluginService.BrowseMarketplaces)
      .mockResolvedValueOnce(browse('accepted') as never)
      .mockRejectedValueOnce(new Error('catalog unreadable'))
      .mockResolvedValueOnce(browse('recovered') as never)
    await expect(useExtensionSourcesStore.getState().loadBrowse()).resolves.toBe(true)
    await expect(useExtensionSourcesStore.getState().loadBrowse()).resolves.toBe(false)
    expect(useExtensionSourcesStore.getState().browse?.Entries?.[0].ID).toBe('accepted')
    expect(useExtensionSourcesStore.getState().browseError).toContain('catalog unreadable')

    await expect(useExtensionSourcesStore.getState().loadBrowse()).resolves.toBe(true)
    expect(useExtensionSourcesStore.getState().browse?.Entries?.[0].ID).toBe('recovered')
    expect(useExtensionSourcesStore.getState().browseError).toBe('')
  })
})
