// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceSource, PolicyView } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

type Props = Record<string, unknown> & { children?: ReactNode }
type FooterButton = { content: ReactNode; onClick: () => void; autoFocus?: boolean }
const strip = (props: Props) => {
  const next = { ...props }
  for (const key of ['direction', 'gap', 'align', 'justify', 'size', 'variant', 'as', 'weight', 'block', 'leadingVisual', 'icon']) delete next[key]
  return next
}

vi.mock('@primer/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const ListSemantics = React.createContext(false)
  const Dialog = ({ title, onClose, footerButtons = [], children, ...props }: Props & { onClose: () => void; footerButtons?: FooterButton[] }) => (
    <div role={String(props.role ?? 'dialog')}><h2>{title as ReactNode}</h2><button data-testid="dialog-close" onClick={onClose}>close</button>{children}
      {footerButtons.map((button, index) => <button key={index} onClick={button.onClick}>{button.content}</button>)}
    </div>
  )
  const Stack = ({ children, ...props }: Props) => <div {...strip(props)}>{children}</div>
  const Text = ({ children, ...props }: Props) => <span {...strip(props)}>{children}</span>
  const Button = ({ children, ...props }: Props) => <button {...strip(props)}>{children}</button>
  const TextInput = (props: Props) => <input {...strip(props)} />
  const Spinner = () => <span>spinner</span>
  const Label = ({ children }: Props) => <label>{children}</label>
  const Caption = ({ children }: Props) => <span>{children}</span>
  const FormControl = Object.assign(({ children }: Props) => <div>{children}</div>, { Label, Caption })
  const Item = ({ children, ...props }: Props) => {
    const Component = React.useContext(ListSemantics) ? 'div' : 'button'
    return <Component {...strip(props)}>{children}</Component>
  }
  const Description = ({ children }: Props) => <div>{children}</div>
  const TrailingAction = ({ label, onClick, ...props }: Props) => <button aria-label={String(label)} onClick={onClick as never} {...strip(props)} />
  const ActionList = Object.assign(({ children, role, ...props }: Props) => (
    <ListSemantics.Provider value={role === 'list'}>
      <div role={role as never} {...strip(props)}>{children}</div>
    </ListSemantics.Provider>
  ), { Item, Description, TrailingAction })
  return { ActionList, Button, Dialog, FormControl, Spinner, Stack, Text, TextInput }
})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const commandMocks = vi.hoisted(() => ({ findCommand: vi.fn(), runCommand: vi.fn() }))
const noticeMocks = vi.hoisted(() => ({ pushNotice: vi.fn() }))
vi.mock('../shared/commands', () => commandMocks)
vi.mock('../shared/noticeStore', () => noticeMocks)
vi.mock('../shared/userError', () => ({ appTranslate: vi.fn(), messageFor: (error: unknown) => String(error) }))
vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({
  PluginService: { ListMarketplaceSources: vi.fn(), PluginPolicy: vi.fn() },
}))

const { PluginService } = await import('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc')
const { useExtensionSourcesStore } = await import('../shared/extensionSourcesStore')
const { usePluginPolicyStore } = await import('../shared/pluginPolicyStore')
const { ExtensionsSourcesDialog } = await import('./ExtensionsSourcesDialog')

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

function source(name: string, incarnation: string, overrides: Partial<MarketplaceSource> = {}): MarketplaceSource {
  return {
    name, kind: 'path', locator: `/source/${name}`, ref: '', addedAt: '',
    origin: { kind: 'path', locator: `/source/${name}`, ref: '' }, incarnation,
    generation: 0, status: 'current', ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  usePluginPolicyStore.setState({ policy: null })
  useExtensionSourcesStore.setState({
    sources: [], ready: false, loading: false, error: '', mutation: null, completionRevision: 0,
    confirmedIncarnation: '', readRevision: 0, browse: null, browseLoading: false, browseError: '',
    browseReadRevision: 0, browseQuery: '', browseKinds: [],
  })
  commandMocks.findCommand.mockImplementation((id: string) => {
    if (id === 'extension.addSource') return {
      enabled: (ctx: { locator?: string }) => Boolean(ctx.locator?.trim()) && useExtensionSourcesStore.getState().ready && usePluginPolicyStore.getState().policy !== null && usePluginPolicyStore.getState().policy?.Error === '' && useExtensionSourcesStore.getState().mutation === null,
    }
    if (id === 'extension.source.remove') return {
      confirm: () => ({ title: 'remove title', body: 'remove body', confirmLabel: 'remove source' }),
    }
    return undefined
  })
  commandMocks.runCommand.mockResolvedValue(true)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render() {
  await act(async () => root.render(<ExtensionsSourcesDialog onClose={vi.fn()} />))
}

async function typeInput(value: string) {
  const input = container.querySelector('[data-testid="extensions-source-input"]') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ExtensionsSourcesDialog', () => {
  it('distinguishes an initial read failure from a successful empty catalog', async () => {
    vi.mocked(PluginService.PluginPolicy).mockResolvedValueOnce(policy as never)
    vi.mocked(PluginService.ListMarketplaceSources)
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValueOnce([] as never)
    await render()
    await act(async () => {})
    expect(container.querySelector('[data-testid="extensions-sources-read-error"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extensions-sources-empty"]')).toBeNull()

    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'extensions.sources.retry')
    await act(async () => retry?.click())
    expect(container.querySelector('[data-testid="extensions-sources-read-error"]')).toBeNull()
    expect(container.querySelector('[data-testid="extensions-sources-empty"]')).not.toBeNull()
  })

  it('keeps Add disabled until policy is readable and distinguishes migrated refresh times', async () => {
    const policyRead = deferred<PolicyView>()
    vi.mocked(PluginService.PluginPolicy).mockReturnValueOnce(policyRead.promise as never)
    vi.mocked(PluginService.ListMarketplaceSources).mockResolvedValueOnce([
      source('migrated', 'one'),
      source('new', 'two', { status: 'never-fetched' }),
    ] as never)
    await render()
    await act(async () => {})
    await typeInput('/another/source')
    const add = container.querySelector('[data-testid="extensions-source-add"]') as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(container.textContent).toContain('extensions.sources.refreshTimeUnknown')
    expect(container.textContent).toContain('extensions.sources.neverRefreshed')

    await act(async () => policyRead.resolve(policy))
    expect(add.disabled).toBe(false)
  })

  it('refuses a stale accepted removal visibly and keeps the captured confirmation open', async () => {
    vi.mocked(PluginService.PluginPolicy).mockResolvedValueOnce(policy as never)
    vi.mocked(PluginService.ListMarketplaceSources).mockResolvedValueOnce([source('replaceable', 'old')] as never)
    await render()
    await act(async () => {})
    const remove = container.querySelector('button[aria-label="extensions.sources.removeAria"]') as HTMLButtonElement
    await act(async () => remove.click())
    expect(container.textContent).toContain('remove title')

    await act(async () => useExtensionSourcesStore.setState({ sources: [source('replaceable', 'new')] }))
    const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent === 'remove source')
    await act(async () => confirm?.click())
    expect(commandMocks.runCommand).not.toHaveBeenCalled()
    expect(noticeMocks.pushNotice).toHaveBeenCalledWith({ level: 'error', text: 'extensions.sources.identityChanged' })
    expect(container.textContent).toContain('remove title')
  })

  it('cancels removal without dispatching an RPC and never offers Remove for the included source', async () => {
    vi.mocked(PluginService.PluginPolicy).mockResolvedValueOnce(policy as never)
    vi.mocked(PluginService.ListMarketplaceSources).mockResolvedValueOnce([
      source('mill', 'included', { included: true }),
      source('removable', 'user'),
    ] as never)
    await render()
    await act(async () => {})
    expect(container.querySelectorAll('button[aria-label="extensions.sources.removeAria"]')).toHaveLength(1)
    const remove = container.querySelector('button[aria-label="extensions.sources.removeAria"]') as HTMLButtonElement
    expect(remove.parentElement?.closest('button')).toBeNull()
    await act(async () => remove.click())
    const cancel = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')
    await act(async () => cancel?.click())
    expect(commandMocks.runCommand).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('remove title')
  })

  it('keeps accepted rows inspectable but disables mutations after a failed reread', async () => {
    vi.mocked(PluginService.PluginPolicy).mockResolvedValueOnce(policy as never)
    vi.mocked(PluginService.ListMarketplaceSources)
      .mockResolvedValueOnce([source('accepted', 'one')] as never)
      .mockRejectedValueOnce(new Error('source catalog unreadable'))
      .mockResolvedValueOnce([source('recovered', 'two')] as never)
    await render()
    await act(async () => {})

    await act(async () => useExtensionSourcesStore.setState((state) => ({ completionRevision: state.completionRevision + 1 })))
    await act(async () => {})
    expect(container.querySelector('[data-source-name="accepted"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extensions-sources-read-error"]')).not.toBeNull()
    expect(container.textContent).toContain('source catalog unreadable')
    await typeInput('/another/source')
    expect((container.querySelector('[data-testid="extensions-source-add"]') as HTMLButtonElement).disabled).toBe(true)
    const remove = container.querySelector('button[aria-label="extensions.sources.removeAria"]') as HTMLButtonElement
    expect(remove.getAttribute('aria-disabled')).toBe('true')
    await act(async () => remove.click())
    expect(container.textContent).not.toContain('remove title')

    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'extensions.sources.retry')
    await act(async () => retry?.click())
    expect(container.querySelector('[data-source-name="recovered"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="extensions-sources-read-error"]')).toBeNull()
  })
})
