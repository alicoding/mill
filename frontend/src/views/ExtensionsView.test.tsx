// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Props = Record<string, unknown> & { children?: ReactNode }

vi.mock('@primer/react', async () => {
  const actual = await vi.importActual<typeof import('@primer/react')>('@primer/react')
  const Stack = ({ children }: Props) => <div>{children}</div>
  const Text = ({ children }: Props) => <span>{children}</span>
  const Heading = ({ children }: Props) => <h1>{children}</h1>
  const Button = ({ children, ...props }: Props) => <button {...props}>{children}</button>
  return { Button, Heading, SegmentedControl: actual.SegmentedControl, Stack, Text }
})
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../shared/PageContainer', () => ({ default: ({ children }: Props) => <main>{children}</main> }))
vi.mock('./ExtensionsSection', () => ({ default: () => <div data-testid="installed-pane" /> }))
vi.mock('./ExtensionsBrowseTab', () => ({ ExtensionsBrowseTab: () => <div data-testid="browse-pane" /> }))
vi.mock('./ExtensionsUpdatesTab', () => ({ ExtensionsUpdatesTab: () => <div data-testid="updates-pane" /> }))
vi.mock('./ExtensionsUpdateDialogHost', () => ({ ExtensionsUpdateDialogHost: () => null }))
vi.mock('./ExtensionsPolicyBanner', () => ({ ExtensionsPolicyBanner: () => null }))
vi.mock('./ThemeImportDialog', () => ({ ThemeImportDialog: () => null }))
vi.mock('../shared/pluginRemoveSignal', () => ({ notifyPluginRemoved: vi.fn() }))
vi.mock('../shared/commands', () => ({ runCommand: vi.fn() }))
vi.mock('../shared/extensionUpdatesStore', () => ({
  refreshUpdates: vi.fn(),
  useExtensionUpdatesStore: (selector: (state: { candidates: unknown[] }) => unknown) => selector({ candidates: [] }),
}))

const { useUISignalStore } = await import('../shared/uiSignalStore')
const { default: ExtensionsView } = await import('./ExtensionsView')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  useUISignalStore.setState({ extensionSourcesRequest: 0, extensionInstalledRequest: 0 })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('ExtensionsView command navigation', () => {
  it('accepts a View installed request that predates its mount and consumes only that request', async () => {
    useUISignalStore.getState().requestExtensionInstalled()
    await act(async () => root.render(<ExtensionsView initialTab="browse" />))

    expect(container.querySelector('[data-testid="installed-pane"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extensions-tab-installed"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid="extensions-tab-browse"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(useUISignalStore.getState().extensionInstalledRequest).toBe(0)

    await act(async () => {
      const browse = [...container.querySelectorAll('button')].find((button) => button.textContent === 'extensions.tabs.browse')
      browse?.click()
    })
    expect(container.querySelector('[data-testid="browse-pane"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extensions-tab-installed"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-testid="extensions-tab-browse"]')?.getAttribute('aria-pressed')).toBe('true')

    await act(async () => useUISignalStore.getState().requestExtensionInstalled())
    expect(container.querySelector('[data-testid="installed-pane"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extensions-tab-installed"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('[data-testid="extensions-tab-browse"]')?.getAttribute('aria-pressed')).toBe('false')

    await act(async () => useUISignalStore.getState().requestExtensionSources())
    expect(container.querySelector('[data-testid="browse-pane"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extensions-tab-installed"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(container.querySelector('[data-testid="extensions-tab-browse"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('does not acknowledge a newer View installed request with an older token', () => {
    useUISignalStore.getState().requestExtensionInstalled()
    const firstRequest = useUISignalStore.getState().extensionInstalledRequest
    useUISignalStore.getState().requestExtensionInstalled()
    useUISignalStore.getState().consumeExtensionInstalledRequest(firstRequest)
    expect(useUISignalStore.getState().extensionInstalledRequest).toBe(firstRequest + 1)
  })
})
