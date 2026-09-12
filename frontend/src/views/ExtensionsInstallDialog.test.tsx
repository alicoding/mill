// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallPreview } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

type Props = Record<string, unknown> & { children?: ReactNode }
const strip = (props: Props) => {
  const next = { ...props }
  for (const key of ['direction', 'gap', 'align', 'size', 'variant', 'as', 'weight']) delete next[key]
  return next
}

vi.mock('@primer/react', () => {
  const Dialog = ({ title, onClose, footerButtons = [], children }: Props & {
    onClose: () => void
    footerButtons?: Array<{ content: ReactNode; onClick: () => void; disabled?: boolean }>
  }) => (
    <div role="dialog">
      <h2>{title as ReactNode}</h2>
      <button data-testid="dialog-close" onClick={onClose}>close</button>
      {children}
      {footerButtons.map((button, index) => <button key={index} disabled={button.disabled} onClick={button.onClick}>{button.content}</button>)}
    </div>
  )
  const Checkbox = (props: Props) => <input type="checkbox" {...strip(props)} />
  const Stack = ({ children, ...props }: Props) => <div {...strip(props)}>{children}</div>
  const Text = ({ children, ...props }: Props) => <span {...strip(props)}>{children}</span>
  const Label = ({ children, ...props }: Props) => <span {...strip(props)}>{children}</span>
  const FormLabel = ({ children }: Props) => <label>{children}</label>
  const FormControl = Object.assign(({ children }: Props) => <div>{children}</div>, { Label: FormLabel })
  return { Checkbox, Dialog, FormControl, Label, Stack, Text }
})
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./ExtensionsPermissions', () => ({ ExtensionsPermissions: () => <div data-testid="permissions" /> }))
vi.mock('./ExtensionsNoticed', () => ({ ExtensionsNoticed: () => <div data-testid="warnings" /> }))

const { ExtensionsInstallDialog } = await import('./ExtensionsInstallDialog')

const preview: InstallPreview = {
  ID: 'plugin', Name: 'Plugin', Version: '1.0.0', Author: '', Description: '', Marketplace: 'source',
  Tier: 'unverified', Capabilities: [], NetworkHosts: [], AnyHost: false, Kinds: [], UsesSecrets: false,
  AlreadyInstalled: false, CanvasHost: false, PolicyRefusal: '', Warnings: [],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('ExtensionsInstallDialog action state', () => {
  it('obeys controlled command predicates for acknowledgement, footer buttons and Escape close', async () => {
    const onCancel = vi.fn()
    const onInstall = vi.fn()
    const onAcknowledgedChange = vi.fn()
    await act(async () => root.render(
      <ExtensionsInstallDialog
        preview={preview}
        busy={false}
        onCancel={onCancel}
        onInstall={onInstall}
        actionState={{ acknowledged: false, onAcknowledgedChange, confirmEnabled: false, cancelEnabled: false }}
      />,
    ))
    const buttons = [...container.querySelectorAll('button')]
    expect(buttons.find((button) => button.textContent === 'extensions.install.cancel')?.disabled).toBe(true)
    expect(buttons.find((button) => button.textContent === 'extensions.install.confirm')?.disabled).toBe(true)
    await act(async () => (container.querySelector('[data-testid="dialog-close"]') as HTMLButtonElement).click())
    expect(onCancel).not.toHaveBeenCalled()
    await act(async () => (container.querySelector('[data-testid="extensions-install-acknowledge"]') as HTMLInputElement).click())
    expect(onAcknowledgedChange).toHaveBeenCalledWith(true)

    await act(async () => root.render(
      <ExtensionsInstallDialog
        preview={preview}
        busy={false}
        onCancel={onCancel}
        onInstall={onInstall}
        actionState={{ acknowledged: true, onAcknowledgedChange, confirmEnabled: true, cancelEnabled: true }}
      />,
    ))
    await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'extensions.install.confirm')?.click())
    expect(onInstall).toHaveBeenCalledOnce()
    await act(async () => (container.querySelector('[data-testid="dialog-close"]') as HTMLButtonElement).click())
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('keeps update mode local acknowledgement behavior unchanged', async () => {
    await act(async () => root.render(
      <ExtensionsInstallDialog preview={preview} busy={false} mode="update" onCancel={vi.fn()} onInstall={vi.fn()} />,
    ))
    const confirm = [...container.querySelectorAll('button')].find((button) => button.textContent === 'extensions.install.updateConfirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await act(async () => (container.querySelector('[data-testid="extensions-install-acknowledge"]') as HTMLInputElement).click())
    expect(confirm.disabled).toBe(false)
  })
})
