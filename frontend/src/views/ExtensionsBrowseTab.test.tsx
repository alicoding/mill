// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowseEntry, BrowseResult, MarketplaceSource, PolicyView } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

type Props = Record<string, unknown> & { children?: ReactNode }
const strip = (props: Props) => {
  const next = { ...props }
  for (const key of ['direction', 'gap', 'align', 'justify', 'size', 'variant', 'as', 'weight', 'showPages', 'currentPage', 'pageCount', 'primaryAction']) delete next[key]
  return next
}

vi.mock('@primer/react', () => {
  const Stack = ({ children, ...props }: Props) => <div {...strip(props)}>{children}</div>
  const Text = ({ children, ...props }: Props) => <span {...strip(props)}>{children}</span>
  const Button = ({ children, ...props }: Props) => <button {...strip(props)}>{children}</button>
  const Label = ({ children, ...props }: Props) => <span {...strip(props)}>{children}</span>
  const Spinner = (props: Props) => <span {...strip(props)}>spinner</span>
  const Pagination = () => <div data-testid="pagination" />
  const BannerPrimaryAction = ({ children, ...props }: Props) => <button {...strip(props)}>{children}</button>
  const Banner = Object.assign(({ title, description, primaryAction, ...props }: Props) => (
    <div {...strip(props)}><strong>{title as ReactNode}</strong><span>{description as ReactNode}</span>{primaryAction as ReactNode}</div>
  ), { PrimaryAction: BannerPrimaryAction })
  return { Banner, Button, Label, Pagination, Spinner, Stack, Text }
})

vi.mock('@primer/react/experimental', () => {
  const Heading = ({ children }: Props) => <h2>{children}</h2>
  const Description = ({ children }: Props) => <p>{children}</p>
  const PrimaryAction = ({ children, ...props }: Props) => <button {...strip(props)}>{children}</button>
  const Blankslate = Object.assign(({ children, ...props }: Props) => <div {...strip(props)}>{children}</div>, { Heading, Description, PrimaryAction })
  return { Blankslate }
})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../shared/ListToolbar', () => ({
  ListToolbar: ({ query, count, searchAriaLabel }: { query: string; count?: unknown; searchAriaLabel: string }) => (
    <div>
      <input data-testid="browse-query" value={query} aria-label={searchAriaLabel} readOnly />
      {count !== undefined && <span data-testid="browse-count">count</span>}
    </div>
  ),
}))
vi.mock('./ExtensionsKindChips', () => ({ ExtensionsKindChips: () => <div data-testid="kind-chips" /> }))
vi.mock('./ExtensionsInstallDialog', () => ({ ExtensionsInstallDialog: () => <div data-testid="install-dialog" /> }))
vi.mock('./ExtensionsSourcesDialog', () => ({
  ExtensionsSourcesDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="sources-dialog"><input data-testid="source-draft" /><button onClick={onClose}>close</button></div>
  ),
}))
vi.mock('../shared/commands', () => ({ runCommand: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../shared/noticeStore', () => ({ pushNotice: vi.fn() }))
vi.mock('../shared/userError', () => ({ appTranslate: vi.fn(), messageFor: (error: unknown) => String(error), userErrorFrom: () => ({ code: '' }) }))
vi.mock('../shared/pluginRemoveSignal', () => ({ notifyPluginRemoved: vi.fn() }))
vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({
  PluginService: { BrowseMarketplaces: vi.fn(), PluginPolicy: vi.fn(), PreviewInstall: vi.fn(), InstallFromMarketplace: vi.fn() },
}))

const { PluginService } = await import('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc')
const { runCommand } = await import('../shared/commands')
const { useExtensionSourcesStore } = await import('../shared/extensionSourcesStore')
const { usePluginPolicyStore } = await import('../shared/pluginPolicyStore')
const { useUISignalStore } = await import('../shared/uiSignalStore')
const { ExtensionsBrowseTab } = await import('./ExtensionsBrowseTab')

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

function entry(id: string, overrides: Partial<BrowseEntry> = {}): BrowseEntry {
  return { Marketplace: 'source', Owner: '', ID: id, Name: id, Description: '', Version: '1.0.0', Author: '', Kinds: [], Installed: false, Tier: 'unverified', PolicyReason: '', ...overrides }
}

function source(overrides: Partial<MarketplaceSource> = {}): MarketplaceSource {
  return {
    name: 'source', kind: 'path', locator: '/source', ref: '', addedAt: '', origin: { kind: 'path', locator: '/source', ref: '' },
    incarnation: 'one', generation: 0, status: 'current', ...overrides,
  }
}

function result(entries: BrowseEntry[], sources: MarketplaceSource[] = []): BrowseResult {
  return { Entries: entries, Sources: sources, InstalledStateReady: true, InstalledStateError: '' }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  usePluginPolicyStore.setState({ policy })
  vi.mocked(PluginService.PluginPolicy).mockResolvedValue(policy as never)
  useExtensionSourcesStore.setState({
    sources: [], ready: false, loading: false, error: '', mutation: null, completionRevision: 0,
    confirmedIncarnation: '', readRevision: 0, browse: null, browseLoading: false, browseError: '',
    browseReadRevision: 0, browseQuery: '', browseKinds: [],
  })
  useUISignalStore.setState({ extensionSourcesRequest: 0, extensionInstalledRequest: 0 })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(sourcesRequest = 0) {
  await act(async () => root.render(<ExtensionsBrowseTab sourcesRequest={sourcesRequest} onInstalled={vi.fn()} />))
}

describe('ExtensionsBrowseTab states', () => {
  it('opens Sources when a command request predates the Browse mount', async () => {
    vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValue(result([]) as never)
    await act(async () => useUISignalStore.getState().requestExtensionSources())
    await render(useUISignalStore.getState().extensionSourcesRequest)
    expect(container.querySelector('[data-testid="sources-dialog"]')).not.toBeNull()
    expect(useUISignalStore.getState().extensionSourcesRequest).toBe(0)

    await act(async () => (container.querySelector('[data-testid="sources-dialog"] button') as HTMLButtonElement).click())
    await act(async () => root.render(<></>))
    await render(useUISignalStore.getState().extensionSourcesRequest)
    expect(container.querySelector('[data-testid="sources-dialog"]')).toBeNull()

    await act(async () => useUISignalStore.getState().requestExtensionSources())
    await render(useUISignalStore.getState().extensionSourcesRequest)
    expect(container.querySelector('[data-testid="sources-dialog"]')).not.toBeNull()
  })

  it('keeps a newer Sources request and preserves an open draft across repeated requests', async () => {
    vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValue(result([]) as never)
    await act(async () => useUISignalStore.getState().requestExtensionSources())
    const firstRequest = useUISignalStore.getState().extensionSourcesRequest
    await act(async () => {
      useUISignalStore.getState().requestExtensionSources()
      useUISignalStore.getState().consumeExtensionSourcesRequest(firstRequest)
    })
    expect(useUISignalStore.getState().extensionSourcesRequest).toBe(firstRequest + 1)

    await render(useUISignalStore.getState().extensionSourcesRequest)
    const input = container.querySelector('[data-testid="source-draft"]') as HTMLInputElement
    input.value = 'draft source'
    await act(async () => useUISignalStore.getState().requestExtensionSources())
    await render(useUISignalStore.getState().extensionSourcesRequest)
    expect((container.querySelector('[data-testid="source-draft"]') as HTMLInputElement).value).toBe('draft source')
  })

  it('keeps an open Sources draft mounted when a successful Browse reload fails', async () => {
    vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValueOnce(result([entry('accepted')]) as never)
    await render()
    await act(async () => {})
    await render(1)
    const input = container.querySelector('[data-testid="source-draft"]') as HTMLInputElement
    input.value = 'draft source'

    const reload = deferred<BrowseResult>()
    vi.mocked(PluginService.BrowseMarketplaces).mockReturnValueOnce(reload.promise as never)
    await act(async () => useExtensionSourcesStore.setState((state) => ({ completionRevision: state.completionRevision + 1 })))
    expect(container.querySelector('[data-testid="extensions-browse-reloading"]')).not.toBeNull()
    expect(container.querySelector('[data-plugin-id="accepted"]')).not.toBeNull()
    await act(async () => reload.reject(new Error('catalog unreadable')))

    expect(container.querySelector('[data-testid="extensions-browse-read-error"]')).not.toBeNull()
    expect(container.querySelector('[data-plugin-id="accepted"]')).not.toBeNull()
    expect(container.textContent).toContain('catalog unreadable')
    expect(container.textContent).toContain('extensions.browse.retry')
    expect((container.querySelector('[data-testid="source-draft"]') as HTMLInputElement).value).toBe('draft source')
    await act(async () => (container.querySelector('[data-testid="sources-dialog"] button') as HTMLButtonElement).click())
    expect(container.querySelector('[data-testid="sources-dialog"]')).toBeNull()
  })

  it('shows delayed and failed reads distinctly and routes Retry through the local command', async () => {
    const pending = deferred<BrowseResult>()
    vi.mocked(PluginService.BrowseMarketplaces).mockReturnValueOnce(pending.promise as never)
    await render()
    expect(container.querySelector('[data-testid="extensions-browse-loading"]')).not.toBeNull()
    await act(async () => pending.reject(new Error('read failed')))
    expect(container.querySelector('[data-testid="extensions-browse-read-error"]')).not.toBeNull()
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'extensions.browse.retry')
    await act(async () => retry?.click())
    expect(runCommand).toHaveBeenCalledWith('extension.browse.retry')
  })

  it('keeps usable blocked rows visible during partial source failure', async () => {
    vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValueOnce(result(
      [entry('blocked', { PolicyReason: 'Blocked by policy', Version: '9.9.9' }), entry('permitted')],
      [source({ status: 'unavailable', errorCode: 'source-read-failed' })],
    ) as never)
    await render()
    await act(async () => {})
    expect(container.querySelector('[data-testid="extensions-browse-partial"]')).not.toBeNull()
    const blocked = container.querySelector('[data-plugin-id="blocked"]')
    expect(blocked?.textContent).toContain('Blocked by policy')
    expect(blocked?.textContent).not.toContain('extensions.versionLabel')
    expect(container.querySelector('[data-plugin-id="permitted"]')?.textContent).toContain('extensions.versionLabel')
    expect((container.querySelector('[data-testid="extensions-browse-install"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not invent a partial failure from the sparse bundled source response', async () => {
    const bundled = {
      name: 'mill', owner: 'Mill', kind: 'bundled', locator: '', ref: '', addedAt: '',
      origin: { kind: 'bundled' }, incarnation: 'bundled', generation: 0, status: 'current', included: true,
    } as MarketplaceSource
    vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValueOnce(result([entry('bundled')], [bundled]) as never)
    await render()
    await act(async () => {})

    expect(container.querySelector('[data-testid="extensions-browse-partial"]')).toBeNull()
  })

  it('shows catalog rows neutrally until installed state recovers', async () => {
    const entries = [entry('reported-installed', { Installed: true }), entry('reported-available')]
    vi.mocked(PluginService.BrowseMarketplaces)
      .mockResolvedValueOnce({ ...result(entries), InstalledStateReady: false, InstalledStateError: 'installed state unreadable' } as never)
      .mockResolvedValueOnce(result(entries) as never)
    await render()
    await act(async () => {})

    expect(container.querySelector('[data-plugin-id="reported-installed"]')).not.toBeNull()
    expect(container.querySelector('[data-plugin-id="reported-available"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="browse-count"]')).toBeNull()
    expect(container.textContent).toContain('extensions.browse.catalogSubtitle')
    expect(container.textContent).not.toContain('extensions.browse.alreadyInstalledHeading')
    expect((container.querySelector('[data-testid="browse-query"]') as HTMLInputElement).ariaLabel).toBe('extensions.browse.catalogSearchAria')
    for (const button of container.querySelectorAll('[data-testid="extensions-browse-install"]')) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }

    await act(async () => useExtensionSourcesStore.setState((state) => ({ completionRevision: state.completionRevision + 1 })))
    await act(async () => {})
    expect(container.querySelector('[data-plugin-id="reported-installed"]')).toBeNull()
    expect(container.querySelector('[data-plugin-id="reported-available"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="browse-count"]')).not.toBeNull()
    expect(container.textContent).toContain('extensions.browse.subtitle')
  })

  it('shows only the installed-state warning and Sources when an unknown catalog is empty', async () => {
    useExtensionSourcesStore.setState({ browseQuery: 'missing', browseKinds: ['tools'] })
    vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValueOnce({
      ...result([]), InstalledStateReady: false, InstalledStateError: 'installed state unreadable',
    } as never)
    await render()
    await act(async () => {})
    expect(container.querySelector('[data-testid="extensions-browse-installed-unknown"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extensions-sources-open"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extensions-browse-empty-state"]')).toBeNull()
  })

  it('gives installed matches precedence over a search no-match', async () => {
    useExtensionSourcesStore.setState({ browseQuery: 'installed' })
    vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValueOnce(result([entry('installed', { Installed: true })]) as never)
    await render()
    await act(async () => {})
    expect(container.textContent).toContain('extensions.browse.alreadyInstalledHeading')
    expect(container.textContent).not.toContain('extensions.browse.noMatchesHeading')
  })

  it('treats a whitespace query with an empty category as a category result', async () => {
    useExtensionSourcesStore.setState({ browseQuery: '   ', browseKinds: ['tools'] })
    vi.mocked(PluginService.BrowseMarketplaces).mockResolvedValueOnce(result([entry('view', { Kinds: ['views'] })], [source()]) as never)
    await render()
    await act(async () => {})
    expect(container.textContent).toContain('extensions.browse.noCategoriesHeading')
    expect(container.textContent).not.toContain('extensions.browse.noMatchesHeading')
  })
})
