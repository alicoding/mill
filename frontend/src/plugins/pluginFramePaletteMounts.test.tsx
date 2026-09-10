// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'

vi.mock('@primer/react', () => ({
  Text: ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => <span {...rest}>{children}</span>,
}))

vi.mock('../app/PluginFrame', () => ({
  PluginFrame: ({ paletteAccess, testId }: { paletteAccess?: boolean; testId: string }) => (
    <div data-testid={testId} data-palette-access={String(!!paletteAccess)} />
  ),
}))
vi.mock('./pluginFrameLazy', () => ({
  PluginFrame: ({ paletteAccess, testId }: { paletteAccess?: boolean; testId: string }) => (
    <div data-testid={testId} data-palette-access={String(!!paletteAccess)} />
  ),
}))

import { PluginViewHost } from '../app/PluginViewHost'
import { PluginBoardPane } from './pluginBoardPane'
import { pluginFramedFaceComponent } from './PluginFaceFrame'
import { collectPluginView, unregisterPluginViews } from './pluginViews'

describe('plugin frame palette mounts', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    unregisterPluginViews('probe')
    container.remove()
  })

  it('opts the main plugin view into the shared adapter', async () => {
    collectPluginView({ pluginId: 'probe', pluginName: 'Probe', viewId: 'main', title: 'Main', version: '1', entry: 'main.html' })
    await act(async () => root.render(<PluginViewHost pluginId="probe" viewId="main" />))
    expect(container.querySelector('[data-testid="plugin-view-probe-main"]')?.getAttribute('data-palette-access')).toBe('true')
  })

  it('opts a board-switcher plugin pane into the shared adapter', async () => {
    collectPluginView({ pluginId: 'probe', pluginName: 'Probe', viewId: 'board', title: 'Board', version: '1', entry: 'board.html', placement: 'board-switcher' })
    await act(async () => root.render(<PluginBoardPane pluginId="probe" viewId="board" spaceCardId="space-1" />))
    expect(container.querySelector('[data-testid="plugin-view-probe-board"]')?.getAttribute('data-palette-access')).toBe('true')
  })

  it('opts a framed canvas face into the shared adapter', async () => {
    const Face = pluginFramedFaceComponent('probe', {
      kind: 'probe.card', label: 'Probe card', icon: 'pencil', source: 'board-local', editRoute: 'none',
    }, 'face.html', '1')
    const object = { ID: 'object-1', Kind: 'probe.card', Payload: {}, Size: { W: 240, H: 160 } } as BoardObject
    await act(async () => root.render(<Face object={object} mirrorVersion={0} />))
    expect(container.querySelector('[data-testid="plugin-face-frame-probe.card"]')?.getAttribute('data-palette-access')).toBe('true')
  })
})
