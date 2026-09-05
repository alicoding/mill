// A capture is a quick-capture face Mill shows in its floating capture
// window, summoned from the Quick Panel or the palette away from the
// canvas: the fast, no-context-switch door into a plugin's own
// content.
//
// A capture takes the same two forms a view does. Declare
// `"entry": "capture.html"` on the capture in your manifest and Mill
// mounts that page in its own sandboxed frame, where
// `window.acquireMillApi()` is the door back. The capture's context
// arrives on that door as the `ctx` event and on `mill.context`, and
// closing the window is `mill.call('capture.done')` once the write
// landed, or `mill.call('capture.cancel')` to close without writing.
//
// The `render(el, ctx)` form below draws into Mill's own document
// instead. It still works and is still supported; reach for an entry
// page for anything new.

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

/** What registerCapture answers, the capture's twin of a view's
 * handle. */
export interface PluginCaptureHandle {
  postMessage: (message: unknown) => void
}

/** id and label are declared in the manifest's contributes.captures,
 * so the Quick Panel can offer the capture without running any plugin
 * code, alongside the entry page when there is one. render draws the
 * face into an element the capture window owns; write through the
 * content doors with ctx.destinationId as the parent, then call
 * ctx.done() — or ctx.cancel() to close without writing. */
export interface PluginCaptureDecl {
  id: string
  render?: (el: HTMLElement, ctx: PluginCaptureCtx) => void
  /** Receives whatever the entry page sent through its own
   * postMessage. */
  onMessage?: (message: unknown) => void
}
