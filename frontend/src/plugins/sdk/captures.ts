// A capture is a quick-capture face Mill shows in its floating capture
// window, summoned from the Quick Panel or the palette away from the
// canvas -- the fast, no-context-switch door into a plugin's own
// content.

import type { PluginTheme, PluginThemeSubscribe } from './theme'

export interface PluginCaptureCtx {
  /** The card the user chose to land the capture in ("" for the top
   * level) — pass it as parentId to a content door. */
  destinationId: string
  done: () => void
  /** Closes the capture window without writing anything. */
  cancel: () => void
  /** The appearance this capture is rendering under. */
  theme: PluginTheme
  /** Subscribes to every later appearance change. */
  onThemeChange: PluginThemeSubscribe
}

/** id and label are declared in the manifest's contributes.captures,
 * so the Quick Panel can offer the capture without running any plugin
 * code. render draws the face into an element the capture window owns;
 * write through the content doors with ctx.destinationId as the
 * parent, then call ctx.done() — or ctx.cancel() to close without
 * writing. */
export interface PluginCaptureDecl {
  id: string
  render: (el: HTMLElement, ctx: PluginCaptureCtx) => void
}
