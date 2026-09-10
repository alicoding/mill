// @vitest-environment jsdom
import { act } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ downloadBlob: vi.fn() }))

vi.mock('./downloadBlob', () => mocks)
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@primer/react', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Text: ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
}))
vi.mock('./OutputViewerToolbar', () => ({
  OutputViewerToolbar: ({ invoke }: { invoke: (command: string) => void }) => (
    <button data-testid="save-output" onClick={() => invoke('output.save')}>Save</button>
  ),
}))
vi.mock('./OutputMediaView', () => ({ OutputMediaView: () => <div /> }))
vi.mock('./CodeEditor', () => ({ CodeEditor: () => <div /> }))
vi.mock('./JsonTree', () => ({ JsonTree: () => <div /> }))
vi.mock('./OutputErrorView', () => ({ OutputErrorView: () => <div /> }))
vi.mock('./OutputLogView', () => ({ OutputLogView: () => <div /> }))
vi.mock('./OutputRenderedView', () => ({ OutputRenderedView: () => <div /> }))
vi.mock('./OutputTableView', () => ({ OutputTableView: () => <div /> }))

import { OutputViewer } from './OutputViewer'
import { useOutputFocusStore } from './outputFocusStore'

describe('OutputViewer save command', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    mocks.downloadBlob.mockReset().mockResolvedValue(undefined)
    useOutputFocusStore.setState({ focused: null })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('publishes and saves the clicked viewer when two binary viewers exist', async () => {
    await act(async () => root.render(
      <>
        <OutputViewer value="first-bytes" shape="binary" site="first" />
        <OutputViewer value="second-payload-is-longer" shape="binary" site="second" />
      </>,
    ))

    const buttons = container.querySelectorAll<HTMLButtonElement>('[data-testid="save-output"]')
    await act(async () => buttons[0].click())

    expect(mocks.downloadBlob).toHaveBeenCalledOnce()
    expect(mocks.downloadBlob.mock.calls[0][0]).toBe('first.txt')
    expect((mocks.downloadBlob.mock.calls[0][1] as Blob).size).toBe('first-bytes'.length)
  })
})
