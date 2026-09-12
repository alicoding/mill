// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import views from '../locales/en/views.json'

type Props = Record<string, unknown> & { children?: ReactNode }

vi.mock('@primer/react', () => ({
  Dialog: ({ title, onClose, footerButtons, children }: Props & {
    title: ReactNode
    onClose: () => void
    footerButtons: Array<{ content: ReactNode; onClick: () => void }>
  }) => (
    <div role="dialog">
      <h1>{title}</h1>
      <button data-testid="host-close" onClick={onClose}>x</button>
      {children}
      {footerButtons.map((button, index) => <button key={index} onClick={button.onClick}>{button.content}</button>)}
    </div>
  ),
  Spinner: () => <span>spinner</span>,
  Stack: ({ children, ...props }: Props) => <div {...props}>{children}</div>,
  Text: ({ children, ...props }: Props) => <span {...props}>{children}</span>,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../shared/commands', () => ({
  findCommand: vi.fn(() => ({ enabled: () => true })),
  runCommand: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('./ExtensionsInstallDialog', () => ({
  ExtensionsInstallDialog: ({ busy, mode, onCancel, onInstall, actionState }: {
    busy: boolean
    mode: string
    onCancel: () => void
    onInstall: () => void
    actionState: { closeLabel: boolean }
  }) => (
    <div data-testid="prepared-dialog" data-busy={String(busy)} data-mode={mode} data-close-label={String(actionState.closeLabel)}>
      <button data-testid="prepared-cancel" onClick={onCancel}>cancel</button>
      <button data-testid="prepared-confirm" onClick={onInstall}>confirm</button>
    </div>
  ),
}))
vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({ PluginService: {} }))

const { runCommand } = await import('../shared/commands')
const { useExtensionMarketplaceInstallStore } = await import('../shared/extensionMarketplaceInstallStore')
const { ExtensionsInstallDialogHost } = await import('./ExtensionsInstallDialogHost')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  useExtensionMarketplaceInstallStore.setState({
    operationId: null, candidate: null, handle: '', expiresAt: '', preview: null, phase: 'idle', mode: 'install',
    visible: false, error: '', errorCode: '', retryable: false, acknowledged: false,
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function renderHost() {
  await act(async () => root.render(<ExtensionsInstallDialogHost />))
}

describe('ExtensionsInstallDialogHost', () => {
  it('shows cancellable preparation without an actionable manifest', async () => {
    useExtensionMarketplaceInstallStore.setState({ operationId: 'operation-one', phase: 'preparing', visible: true })
    await renderHost()
    expect(container.textContent).toContain('extensions.install.preparingTitle')
    expect(views.extensions.install.preparingTitle).toBe('Preparing extension')
    expect(container.querySelector('[data-testid="extensions-install-loading"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="prepared-dialog"]')).toBeNull()
    await act(async () => (container.querySelector('[data-testid="host-close"]') as HTMLButtonElement).click())
    expect(runCommand).toHaveBeenCalledWith('extensions.install.dismiss', { kind: 'extensionInstallAttempt', operationId: 'operation-one' })
  })

  it('offers Retry only for a retryable preparation error', async () => {
    useExtensionMarketplaceInstallStore.setState({
      operationId: 'operation-two', phase: 'error', visible: true, error: 'preview expired', retryable: true,
    })
    await renderHost()
    expect(container.querySelector('[data-testid="extensions-install-error"]')?.textContent).toBe('preview expired')
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'extensions.install.retry')
    await act(async () => retry?.click())
    expect(runCommand).toHaveBeenCalledWith('extensions.install.retry', { kind: 'extensionInstallAttempt', operationId: 'operation-two' })
  })

  it('keeps the reviewed manifest visible while committing and routes Close through dismiss', async () => {
    useExtensionMarketplaceInstallStore.setState({
      operationId: 'operation-three', phase: 'committing', visible: true, mode: 'update',
      preview: {
        ID: 'plugin', Name: 'Plugin', Version: '2.0.0', Author: '', Description: '', Marketplace: 'source', Tier: 'verified',
        Capabilities: [], NetworkHosts: [], AnyHost: false, NetworkGrantVersion: 1, NetworkMethods: {}, Kinds: [], UsesSecrets: false,
        AlreadyInstalled: true, CanvasHost: false, PolicyRefusal: '', Warnings: [],
      },
    })
    await renderHost()
    const dialog = container.querySelector('[data-testid="prepared-dialog"]')
    expect(dialog?.getAttribute('data-busy')).toBe('true')
    expect(dialog?.getAttribute('data-mode')).toBe('update')
    expect(dialog?.getAttribute('data-close-label')).toBe('true')
    await act(async () => (container.querySelector('[data-testid="prepared-cancel"]') as HTMLButtonElement).click())
    expect(runCommand).toHaveBeenCalledWith('extensions.install.dismiss', { kind: 'extensionInstallAttempt', operationId: 'operation-three' })
  })
})
