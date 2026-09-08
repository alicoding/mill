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

// ACTIVATION_SCRIPT_PATH is the third-party activation frame's own
// script (docs/goals/0375 S1b): it imports the plugin's main.js and
// exposes the same MillPluginAPI shape a same-DOM plugin holds, built
// over messages rather than direct calls. Distinct from bootstrap.js
// -- an activation frame's document has no plugin-authored page, so it
// never needs window.acquireMillApi()'s entry-page contract.
export const ACTIVATION_SCRIPT_PATH = '/plugin-frame/activation.js'

export function activationScriptUrl(): string {
  return new URL(ACTIVATION_SCRIPT_PATH, window.location.href).href
}

// framePolicy takes every script the document loads with <script src>
// as its own CSP source: a source naming a path (not just an origin)
// matches only that exact path, so bootstrap.js and activation.js each
// need their own entry when a frame loads both.
function framePolicy(base: string, scripts: readonly string[]): string {
  return [
    `default-src 'none'`,
    `script-src ${base} ${scripts.join(' ')}`,
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

// ActivationFrameInit is an activation frame's own mount data (docs/
// goals/0375 S1b), carried on the same "mill-frame-init" meta element
// an entry page's FrameInit uses -- the two never share a document, so
// the one name is unambiguous. settings and storage are resolved
// snapshots (settings.get/storage.get stay synchronous frame-side);
// a later change arrives as an event instead of a re-read.
export interface ActivationFrameInit {
  pluginId: string
  millVersion: string
  // version rides the query on main.js's import, so a reinstalled
  // plugin never serves a cached module -- the same cache-busting a
  // same-DOM activation's own import URL carries.
  version: string
  settings: Record<string, boolean | string | number>
  storage: Record<string, unknown>
  // exports (goal 0364): the manifest's own exports allowlist, so the
  // frame can split its activate() return value into data (ungated)
  // and methods (gated) BEFORE anything crosses the postMessage
  // boundary at activation-done.
  exports: string[]
}

// buildFrameSrcdoc prepends Mill's four head pieces to the plugin's own
// page. The pieces go FIRST so the policy governs every element after
// it and every script exists before the page's own script runs; the
// page keeps everything else it wrote. Parsed via DOMParser (goal
// 0382): the browser's own HTML parser always resolves a head to
// inject into, however the page opened its tags -- a document with no
// head or html element of its own gets one, matching how the iframe
// that actually renders this srcdoc would parse it anyway -- where a
// regex hunting for a literal "<head" or "<html" can be fooled by a
// comment or string containing the same text. An activation frame has
// no plugin-authored page at all: html is "" and DOMParser still gives
// it a head to inject into.
export function buildFrameSrcdoc(base: string, scripts: readonly string[], html: string, init: FrameInit | ActivationFrameInit, tokens: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const injected = doc.createElement('head')
  injected.innerHTML = [
    `<base href="${base}">`,
    `<meta http-equiv="Content-Security-Policy" content="${framePolicy(base, scripts)}">`,
    `<meta name="mill-frame-init" content="${escapeForAttribute(JSON.stringify(init))}">`,
    `<style id="mill-tokens">${tokens}</style>`,
    // crossorigin="anonymous" makes each a VERIFIED CORS fetch rather
    // than an anonymously cross-origin classic script: the frame's
    // origin is opaque, so every script here is cross-origin to it by
    // definition, and an unverified cross-origin script's own dynamic
    // import() (the activation script's own door onto main.js) resolves
    // relative specifiers against "about:blank" instead of its real URL
    // -- a browser restriction, not a Mill choice. The server answers
    // the matching header (cspmiddleware.go's PluginFrameCORSMiddleware).
    ...scripts.map((src) => `<script src="${src}" crossorigin="anonymous"></script>`),
  ].join('')
  doc.head.prepend(...Array.from(injected.childNodes))
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : ''
  return doctype + doc.documentElement.outerHTML
}
