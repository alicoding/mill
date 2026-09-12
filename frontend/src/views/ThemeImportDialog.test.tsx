// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Props = Record<string, unknown> & { children?: ReactNode }
type FooterButton = { content: ReactNode; onClick: () => void; disabled?: boolean }

vi.mock('@primer/react', () => {
  const Dialog = ({ title, onClose, footerButtons, children }: Props & { title: ReactNode; onClose: () => void; footerButtons: FooterButton[] }) => (
    <div role="dialog">
      <h1>{title}</h1>
      <button data-testid="dialog-close" onClick={onClose}>close</button>
      {children}
      {footerButtons.map((button, index) => (
        <button key={index} disabled={button.disabled} onClick={button.onClick}>{button.content}</button>
      ))}
    </div>
  )
  const Stack = ({ children, ...rest }: Props) => <div {...rest}>{children}</div>
  const Text = ({ children, ...rest }: Props) => <span {...rest}>{children}</span>
  const Button = ({ children, ...rest }: Props) => <button {...rest}>{children}</button>
  const TextInput = (props: Props) => <input {...props} />
  const SelectOption = ({ children, ...rest }: Props) => <option {...rest}>{children}</option>
  const Select = Object.assign(({ children, ...rest }: Props) => <select {...rest}>{children}</select>, { Option: SelectOption })
  const Label = ({ children }: Props) => <label>{children}</label>
  const FormControl = Object.assign(({ children }: Props) => <div>{children}</div>, { Label })
  return { Button, Dialog, FormControl, Select, Stack, Text, TextInput }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }),
}))
vi.mock('../shared/AdvancedDisclosure', () => ({
  AdvancedDisclosure: ({ children }: Props) => <div>{children}</div>,
}))
vi.mock('../shared/noticeStore', () => ({ pushNotice: vi.fn() }))
vi.mock('../shared/userError', () => ({ messageFor: (error: unknown) => error instanceof Error ? error.message : String(error) }))
vi.mock('../shared/commands', () => ({
  findCommand: vi.fn(() => ({ enabled: () => true })),
  runCommand: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc', () => ({
  PluginService: { PreviewThemeImport: vi.fn() },
}))

const { PluginService } = await import('../../bindings/github.com/alicoding/mill/internal/services/pluginsvc')
const { runCommand } = await import('../shared/commands')
const { useExtensionMarketplaceInstallStore } = await import('../shared/extensionMarketplaceInstallStore')
const { useExtensionRecoveryStore } = await import('../shared/extensionRecoveryStore')
const { ThemeImportDialog } = await import('./ThemeImportDialog')

const preview = (name: string, family = '') => ({
  SourceName: `${name}.json`, SourceSHA256: 'a'.repeat(64), SuggestedName: name, Family: family,
  Mapped: 2, Total: 4, MappedKeys: ['foreground', 'editor.background'], UnmappedKeys: ['x', 'y'], InvalidKeys: [],
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function chosenFile(name: string, bytes: Uint8Array) {
  return { name, size: bytes.byteLength, arrayBuffer: vi.fn(() => Promise.resolve(bytes.buffer)) } as unknown as File
}

let container: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  onClose = vi.fn<() => void>()
  vi.mocked(PluginService.PreviewThemeImport).mockReset()
  vi.mocked(runCommand).mockClear()
  useExtensionMarketplaceInstallStore.setState({ phase: 'idle' })
  useExtensionRecoveryStore.setState({ unresolved: false, retrying: false, detail: '' })
  act(() => root.render(<ThemeImportDialog onClose={onClose} />))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function selectFile(file: File | undefined) {
  const input = container.querySelector('[data-testid="theme-import-file"]') as HTMLInputElement
  Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
}

function footerButton(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent === text)
  if (!button) throw new Error(`missing ${text}`)
  return button
}

describe('ThemeImportDialog', () => {
  it('preserves original bytes in base64 and requires an explicit family when the source has none', async () => {
    vi.mocked(PluginService.PreviewThemeImport).mockResolvedValue(preview('Vitesse Light'))
    await selectFile(chosenFile('vitesse-light.json', new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])))

    expect(PluginService.PreviewThemeImport).toHaveBeenCalledWith('77u/e30=', 'vitesse-light.json')
    expect((container.querySelector('[data-testid="theme-import-name"]') as HTMLInputElement).value).toBe('Vitesse Light')
    expect(footerButton('extensions.themeImport.import').disabled).toBe(true)

    const family = container.querySelector('[data-testid="theme-import-family"]') as HTMLSelectElement
    await act(async () => { family.value = 'light'; family.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(footerButton('extensions.themeImport.import').disabled).toBe(false)

    // A cancelled picker leaves the accepted preview untouched.
    await selectFile(undefined)
    expect((container.querySelector('[data-testid="theme-import-name"]') as HTMLInputElement).value).toBe('Vitesse Light')
  })

  it('does not let an older asynchronous preview replace the newest file', async () => {
    const old = deferred<ReturnType<typeof preview>>()
    vi.mocked(PluginService.PreviewThemeImport)
      .mockReturnValueOnce(old.promise as never)
      .mockResolvedValueOnce(preview('New theme', 'dark'))

    await selectFile(chosenFile('old.json', new Uint8Array([1])))
    await selectFile(chosenFile('new.json', new Uint8Array([2])))
    expect((container.querySelector('[data-testid="theme-import-name"]') as HTMLInputElement).value).toBe('New theme')

    await act(async () => { old.resolve(preview('Old theme', 'light')); await old.promise })
    expect((container.querySelector('[data-testid="theme-import-name"]') as HTMLInputElement).value).toBe('New theme')
  })

  it('freezes the form into the shared preparation command and hides nested presentation', async () => {
    vi.mocked(PluginService.PreviewThemeImport).mockResolvedValue(preview('Ready', 'light'))
    await selectFile(chosenFile('ready.json', new Uint8Array([3])))

    await act(async () => footerButton('extensions.themeImport.import').click())
    expect(runCommand).toHaveBeenCalledWith('extensions.install.prepare', {
      kind: 'extensionInstallCandidate',
      candidate: {
        Kind: 'theme', Marketplace: '', Incarnation: '', ID: '', Version: '', Locator: '',
        Encoded: 'Aw==', Basename: 'ready.json', DisplayName: 'Ready', Family: 'light',
      },
    })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => useExtensionMarketplaceInstallStore.setState({ phase: 'preparing' }))
    expect(container.querySelector('[data-testid="theme-import-dialog"]')).toBeNull()
    await act(async () => useExtensionMarketplaceInstallStore.setState({ phase: 'idle' }))
    expect((container.querySelector('[data-testid="theme-import-name"]') as HTMLInputElement).value).toBe('Ready')
  })

  it('shows a read error without closing', async () => {
    vi.mocked(PluginService.PreviewThemeImport).mockRejectedValue(new Error('Choose valid JSON.'))
    await selectFile(chosenFile('broken.json', new Uint8Array([4])))
    expect(container.querySelector('[data-testid="theme-import-error"]')?.textContent).toBe('Choose valid JSON.')
    expect(onClose).not.toHaveBeenCalled()
  })
})
