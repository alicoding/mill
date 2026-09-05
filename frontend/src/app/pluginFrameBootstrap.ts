import { THEME_VARIABLES } from '../shared/appearanceThemes'
import type { PluginTheme } from '../plugins/sdk'

// What Mill injects into a plugin's own page before the page's own
// markup runs (docs/goals/0349, docs/adr/0047): a <base> pointing at
// the plugin folder, the frame's Content-Security-Policy, the current
// theme tokens, and the bootstrap that defines the page's only door
// back to Mill.
//
// The frame is sandboxed WITHOUT allow-same-origin, so its document
// has an opaque origin: it cannot reach Mill's DOM, cookies or
// storage, and `postMessage` to the parent is the only channel that
// exists. Because the origin is opaque, a CSP `'self'` source would
// match nothing at all -- every source list below names the plugin's
// own folder URL instead, which is also exactly what the standard's
// entry-page rule promises ("the page loads only files from the
// plugin folder").
//
// A srcdoc document INHERITS the embedding document's policy, and
// Mill's own forbids inline script (docs/platform/PLUGIN-THREAT-
// MODEL.md, T9). So neither piece Mill injects may be inline script:
// the bootstrap arrives as a <script src> for a file Mill serves, and
// the page's mount data as a <meta> that file reads. The same
// inheritance is why an entry page's own script must live in a file
// too, which the standard's entry-page rule states and its check
// enforces.

export interface FrameInit {
  theme: PluginTheme
  state: unknown
  context: Record<string, unknown>
}


// millTokenCss reads the tokens Mill's own interface is painted with
// off the host document's root and writes them as one declaration
// block. Only the documented vocabulary is copied: those are the names
// promised to exist in every scheme, so a page built on them follows
// the user's choice everywhere it changes.
export function millTokenCss(read: (name: string) => string): string {
  const declarations = THEME_VARIABLES
    .map((name) => [name, read(name).trim()] as const)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}:${value}`)
  return `:root{${declarations.join(';')}}`
}

// hostTokenReader resolves those names against the host document's own
// root, which is where the appearance layer settles every scheme.
export function hostTokenReader(root: HTMLElement = document.documentElement): (name: string) => string {
  const computed = getComputedStyle(root)
  return (name) => computed.getPropertyValue(name)
}

export function pluginAssetBase(pluginId: string): string {
  return new URL(`/plugins/${pluginId}/`, window.location.href).href
}

// FRAME_BOOTSTRAP_PATH is served from the app's own static files
// (frontend/public), so the URL is stable and needs no build step.
export const FRAME_BOOTSTRAP_PATH = '/plugin-frame/bootstrap.js'

export function frameBootstrapUrl(): string {
  return new URL(FRAME_BOOTSTRAP_PATH, window.location.href).href
}

function framePolicy(base: string, bootstrap: string): string {
  return [
    `default-src 'none'`,
    `script-src ${base} ${bootstrap}`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base} data:`,
    `connect-src 'none'`,
    `frame-src 'none'`,
  ].join('; ')
}

// escapeForAttribute keeps an injected JSON literal from ending the
// attribute, or the element, that carries it.
function escapeForAttribute(json: string): string {
  return json.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// buildFrameSrcdoc prepends Mill's four head pieces to the plugin's own
// page. The pieces go FIRST so the policy governs every element after
// it and the bootstrap exists before the page's own script runs; the
// page keeps everything else it wrote, including its own <head>.
export function buildFrameSrcdoc(base: string, bootstrap: string, html: string, init: FrameInit, tokens: string): string {
  const head = [
    `<base href="${base}">`,
    `<meta http-equiv="Content-Security-Policy" content="${framePolicy(base, bootstrap)}">`,
    `<meta name="mill-frame-init" content="${escapeForAttribute(JSON.stringify(init))}">`,
    `<style id="mill-tokens">${tokens}</style>`,
    `<script src="${bootstrap}"></script>`,
  ].join('')
  const headOpen = /<head[^>]*>/i.exec(html)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    return html.slice(0, at) + head + html.slice(at)
  }
  const htmlOpen = /<html[^>]*>/i.exec(html)
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length
    return html.slice(0, at) + `<head>${head}</head>` + html.slice(at)
  }
  return `<head>${head}</head>${html}`
}
