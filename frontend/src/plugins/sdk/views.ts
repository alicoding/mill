// A view is a plugin-owned work tab: its own full tab in Mill's main
// window, for something bigger than fits on a canvas object's face.
//
// There are two forms. The one to reach for is an ENTRY PAGE: put
// `"entry": "view.html"` on the view in your manifest, ship that page
// beside your `main.js`, and Mill mounts it in its own sandboxed
// frame. Inside it you write whatever HTML, CSS and JavaScript you
// like, with any framework you like, and nothing you write can reach
// Mill's own document. The page's door back to Mill is
// `window.acquireMillApi()`.
//
// The frame is sandboxed with no same-origin access and runs under a
// policy that loads scripts, styles, fonts and images only from your
// own plugin folder, so ship beside the page whatever it needs. Your
// script goes in a `.js` file the page loads with `<script src>`: an
// inline `<script>` and an `onclick` attribute never run. Styles may
// stay inline. Mill injects the theme it is painted with as CSS custom
// properties on the page's root and updates them in place when the
// user changes theme, so a page built on those variables follows the
// user's choice with no JavaScript at all.
//
// ```html
// <!doctype html>
// <html><head><style>body { color: var(--fgColor-default) }</style></head>
// <body><div id="count"></div><script src="view.js"></script></body></html>
// ```
//
// ```js
// const mill = window.acquireMillApi()
// const entries = await mill.call('query', {})
// document.getElementById('count').textContent = String(entries.length)
// mill.on('contents:changed', () => location.reload())
// ```
//
// The page also answers `window.acquireVsCodeApi()`, with the three
// methods a webview written for that editor expects, so such a page
// drops in unchanged.
//
// The second form is `render(el, ctx)`, which draws into an element of
// Mill's own document. It still works and is still supported, but a
// view written that way shares Mill's stylesheet and Mill's window, so
// reach for an entry page for anything new.

import type { PluginTheme, PluginThemeSubscribe } from './theme'

export interface PluginViewCtx {
  pluginId: string
  viewId: string
  /** The appearance this view is rendering under. */
  theme: PluginTheme
  /** Subscribes to every later appearance change. */
  onThemeChange: PluginThemeSubscribe
}

/** What registerView answers: the plugin's end of the two-way channel
 * to its own entry page. postMessage delivers a value to the page's
 * `onMessage` handlers, and the page's own `postMessage` arrives at the
 * `onMessage` this declaration carries. On a view that renders into
 * Mill's document instead of a page, postMessage has nowhere to
 * deliver and does nothing. */
export interface PluginViewHandle {
  postMessage: (message: unknown) => void
}

/** id must match a view the manifest declares under contributes.views,
 * which carries the tab's title and the entry page when there is one.
 * A view whose manifest names an entry page needs no render at all,
 * and needs registerView only to exchange messages with that page.
 * render draws into an element sized to the panel, plain DOM like a
 * canvas object's face, and runs once per mount: the panel stays
 * mounted while its tab is hidden, and mounts again after a reload
 * restores the tab. Opening the view is a registry command,
 * view.open.<plugin>.<id>, reachable from the palette and callable
 * from the plugin's own commands. */
export interface PluginViewDecl {
  id: string
  render?: (el: HTMLElement, ctx: PluginViewCtx) => void
  /** Receives whatever the entry page sent through its own
   * postMessage. */
  onMessage?: (message: unknown) => void
}
