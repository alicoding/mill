import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider } from '@primer/react/next'
import { OutputViewer } from '../shared/OutputViewer'
import { readResolvedTheme, subscribeResolvedTheme } from '../shared/appearance'
import type { PluginOutputOptions } from './sdk'

// The host half of api.ui.renderOutput (goal 0326). A plugin's view
// draws plain DOM, so the viewer arrives as its own React root inside
// the element the plugin hands over. That root is outside the app's
// tree and therefore outside its providers: Primer's ThemeProvider is
// mounted here, over the SAME resolved appearance the app root uses, so
// the viewer inside a plugin view looks like the viewer everywhere
// else. i18next needs no provider -- it is a singleton the app
// initializes at boot.
//
// Loaded lazily by hostApi.ts: activation must not pull the app's
// module graph forward (loader.ts's import discipline), and a plugin
// that never renders output never pays for the viewer's chunk.

interface Mounted {
  root: Root
  unsubscribe: () => void
}

const mounted = new WeakMap<HTMLElement, Mounted>()

function draw(root: Root, value: unknown, options: PluginOutputOptions, pluginId: string) {
  const theme = readResolvedTheme()
  root.render(
    <ThemeProvider colorMode={theme.mode}>
      <OutputViewer
        value={value}
        shape={options.shape}
        mime={options.mime}
        title={options.title}
        site={`plugin-${pluginId}`}
        testId={`plugin-output-${pluginId}`}
      />
    </ThemeProvider>,
  )
}

export function renderOutputInto(el: HTMLElement, value: unknown, options: PluginOutputOptions, pluginId: string): void {
  unmountOutput(el)
  el.replaceChildren()
  const root = createRoot(el)
  // A theme change has to reach a detached root by hand: it sits under
  // no provider of the app's, so nothing else would re-render it.
  const unsubscribe = subscribeResolvedTheme(() => draw(root, value, options, pluginId))
  mounted.set(el, { root, unsubscribe })
  draw(root, value, options, pluginId)
}

export function unmountOutput(el: HTMLElement): void {
  const existing = mounted.get(el)
  if (!existing) return
  mounted.delete(el)
  existing.unsubscribe()
  // Unmounting synchronously from inside a React commit throws; the
  // caller here is always a plugin's own event handler, never a render,
  // but the microtask keeps that true if a future caller is not.
  queueMicrotask(() => existing.root.unmount())
}
