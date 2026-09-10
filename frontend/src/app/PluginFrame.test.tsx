// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginFrame } from './PluginFrame'
import { useAppStore } from '../shared/store'
import { setMenuOwnedCombos } from '../shared/menuOwnership'

// @primer/react pulls in its own stylesheet at import, which the node
// test runtime cannot load (NavRail.test.tsx carries the same stand-in)
// -- PluginFrame only reaches Text for its failed-fetch fallback text,
// never exercised by this file's theme-attribute assertions.
vi.mock('@primer/react', () => ({
  Text: ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => <span {...rest}>{children}</span>,
}))

// The activation frame's own host element (the <iframe>) carries the
// same theme attribute pair as PluginViewHost's non-framed div, read
// from the same usePluginTheme source -- proven by flipping the
// resolved theme mid-mount and reading the iframe's own attributes
// back, not by asserting on the div branch a second time.

vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>()
  return { ...actual, Events: { ...actual.Events, On: () => () => undefined } }
})

function setResolvedTheme(mode: 'light' | 'dark', scheme: string): void {
  const root = document.documentElement
  root.dataset.millTheme = mode
  root.dataset.millScheme = scheme
}

describe('PluginFrame theme attributes', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html><body></body></html>' })))
    useAppStore.setState({ view: { kind: 'home' }, keybindingOverrides: {}, paletteOpen: false })
    setMenuOwnedCombos([])
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function mount(mode: 'light' | 'dark', scheme: string, paletteAccess = false): Promise<void> {
    setResolvedTheme(mode, scheme)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <PluginFrame
          pluginId="probe"
          surfaceId="tester"
          title="Tester"
          entry="view.html"
          version="1"
          stateKey="view:tester:state"
          paletteAccess={paletteAccess}
          context={{}}
          onSink={() => {}}
          testId="plugin-view-probe-tester"
        />,
      )
      // The entry fetch and its DOM parse resolve inside the load
      // effect's own microtasks -- flushed before the iframe (which
      // the resolved srcdoc gates) is queried.
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  function iframe(): Element | null {
    return container.querySelector('[data-testid="plugin-view-probe-tester"]')
  }

  it('carries the resolved theme pair in light mode', async () => {
    await mount('light', 'light')
    expect(iframe()?.getAttribute('data-mill-theme')).toBe('light')
    expect(iframe()?.getAttribute('data-mill-scheme')).toBe('light')
  })

  it('carries the resolved theme pair in dark mode, and updates it live on a theme change', async () => {
    await mount('dark', 'dark_dimmed')
    expect(iframe()?.getAttribute('data-mill-theme')).toBe('dark')
    expect(iframe()?.getAttribute('data-mill-scheme')).toBe('dark_dimmed')

    await act(async () => {
      setResolvedTheme('light', 'light_high_contrast')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(iframe()?.getAttribute('data-mill-theme')).toBe('light')
    expect(iframe()?.getAttribute('data-mill-scheme')).toBe('light_high_contrast')
  })

  it('advertises palette bindings only to an opted-in frame', async () => {
    await mount('light', 'light', true)
    const srcdoc = (iframe() as HTMLIFrameElement).srcdoc
    const parsed = new DOMParser().parseFromString(srcdoc, 'text/html')
    const init = JSON.parse(parsed.querySelector('meta[name="mill-frame-init"]')?.getAttribute('content') ?? '{}') as { paletteBindings?: unknown }
    expect(init.paletteBindings).toEqual([
      { mods: ['cmd'], key: 'K' },
      { mods: ['cmd'], key: '/' },
    ])
  })

  it('pushes changed bindings without rebuilding or losing the frame document', async () => {
    await mount('light', 'light', true)
    const frame = iframe() as HTMLIFrameElement
    const before = frame.srcdoc
    const post = vi.spyOn(frame.contentWindow!, 'postMessage')
    post.mockClear()

    await act(async () => {
      useAppStore.getState().setKeybindingOverrides({ 'palette.open': { mods: ['cmd'], key: 'P' } })
      await Promise.resolve()
    })

    expect(frame.srcdoc).toBe(before)
    expect(post).toHaveBeenCalledWith({
      mill: 1,
      kind: 'event',
      event: 'palette-bindings',
      payload: [
        { mods: ['cmd'], key: 'P' },
        { mods: ['cmd'], key: '/' },
      ],
      tokens: undefined,
    }, '*')
  })
})
