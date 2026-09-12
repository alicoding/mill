// @vitest-environment jsdom
import { act, type ChangeEvent, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportMode, type ImportPreview } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Props = Record<string, unknown> & { children?: ReactNode }
vi.mock('@primer/react', () => ({
  Stack: ({ children }: Props) => <div>{children}</div>,
  Text: ({ children }: Props) => <span>{children}</span>,
  Dialog: ({ children, footerButtons }: Props & { footerButtons?: { content: string; onClick: () => void }[] }) => <div data-testid="dialog">{children}{footerButtons?.map((button) => <button key={button.content} onClick={button.onClick}>{button.content}</button>)}</div>,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const previewImport = vi.fn()
const applyImport = vi.fn()
vi.mock('../shared/bindings', () => ({ ConfigureService: {
  PreviewAIProviderImport: (...args: unknown[]) => previewImport(...args),
  ApplyAIProviderImport: (...args: unknown[]) => applyImport(...args),
} }))

import { useAIProviderImport } from './useAIProviderImport'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const replacePreview = (revision: string): ImportPreview => ({
  providerId: 'provider-1', mode: ImportMode.ImportModeReplace, expectedRevision: revision,
  current: { label: 'Current', kind: 'openai-compatible', endpoint: 'http://current', model: 'old', keyRef: '' },
  proposed: { label: 'Imported', kind: 'openai-compatible', endpoint: 'http://imported', model: 'new', keyRef: 'key' },
  references: { Boards: [], Workflows: [], Plugins: [] },
  impact: { providerId: 'provider-1', configRevision: revision, runIDs: [], workflowIDs: [], mutationAllowed: true, blockerCodes: [] },
} as ImportPreview)

function Harness({ imported }: { imported: () => void }) {
  const { handleImportFile, dialog, importError } = useAIProviderImport(imported)
  return <><button data-testid="choose" onClick={() => handleImportFile({ target: { files: [{ text: () => selectedPromise }], value: '' } } as unknown as ChangeEvent<HTMLInputElement>)}>choose</button>{dialog}<span data-testid="error">{importError}</span></>
}

let selectedPromise: Promise<string> = Promise.resolve('')

describe('useAIProviderImport', () => {
  let container: HTMLDivElement
  let root: Root
  let mounted: boolean
  const imported = vi.fn()
  beforeEach(() => {
    previewImport.mockReset()
    applyImport.mockReset()
    imported.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mounted = true
    act(() => root.render(<Harness imported={imported} />))
  })
  afterEach(() => { if (mounted) act(() => root.unmount()); container.remove() })

  async function choose(text: string, textPromise: Promise<string> = Promise.resolve(text)) {
    selectedPromise = textPromise
    const button = container.querySelector('[data-testid="choose"]') as HTMLButtonElement
    await act(async () => {
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('shows backend replacement review even without a locally known target', async () => {
    previewImport.mockResolvedValue(replacePreview('r1'))
    await choose('file-a')
    expect(container.querySelector('[data-testid="dialog"]')).not.toBeNull()
    expect(applyImport).not.toHaveBeenCalled()
  })

  it('shows secret verification state and every affected consumer', async () => {
    const preview = replacePreview('r1')
    preview.references = {
      Workflows: ['workflow-1'],
      Boards: [{ BoardID: 'board-1', ObjectID: 'object-1', Label: 'Board object' }],
      Plugins: [{ PluginID: 'plugin-1', SettingKey: 'provider', Label: 'Plugin setting' }],
    }
    previewImport.mockResolvedValue(preview)
    await choose('file-a')
    const text = container.textContent ?? ''
    expect(text).toContain('configureAIProviders.import.secretUnverified')
    expect(text).toContain('configureAIProviders.import.workflowConsumer')
    expect(text).toContain('configureAIProviders.import.boardConsumer')
    expect(text).toContain('configureAIProviders.import.pluginConsumer')
  })

  it('ignores a slow preview when a newer file is selected', async () => {
    const slow = deferred<ImportPreview>()
    previewImport.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(replacePreview('new'))
    await choose('file-a')
    await choose('file-b')
    slow.resolve(replacePreview('old'))
    await act(async () => { await slow.promise })
    applyImport.mockResolvedValue({})
    const replace = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('replace'))!
    await act(async () => { replace.click(); await Promise.resolve() })
    expect(applyImport).toHaveBeenCalledWith('file-b', 'new')
  })

  it('does not reopen after cancellation while a preview is pending', async () => {
    const slow = deferred<ImportPreview>()
    previewImport.mockReturnValue(slow.promise)
    await choose('file-a')
    act(() => root.unmount())
    mounted = false
    slow.resolve(replacePreview('late'))
    await act(async () => { await slow.promise })
    expect(container.querySelector('[data-testid="dialog"]')).toBeNull()
  })

  it('applies the exact displayed payload and revision', async () => {
    previewImport.mockResolvedValue(replacePreview('shown-revision'))
    applyImport.mockResolvedValue({})
    await choose('exact-file')
    const replace = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('replace'))!
    await act(async () => { replace.click(); await Promise.resolve() })
    expect(applyImport).toHaveBeenCalledWith('exact-file', 'shown-revision')
    expect(imported).toHaveBeenCalledOnce()
  })
})
