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

export interface FrameInit {
  theme: PluginTheme
  state: unknown
  context: Record<string, unknown>
}

// millFrameBootstrap runs INSIDE the frame. It is never called here:
// its compiled source is stringified into the page, so it must stay
// self-contained -- no import, no module-scope reference -- or the
// injected copy would reference identifiers that do not exist there.
function millFrameBootstrap(): void {
  interface Envelope { mill?: number; id?: number; kind?: string; event?: string; method?: string; args?: unknown[]; payload?: unknown; tokens?: string; ok?: boolean; result?: unknown; error?: string }
  const host = window as unknown as {
    __millFrame?: { theme: { mode: string; scheme: string }; state: unknown; context: Record<string, unknown> }
    acquireMillApi?: () => unknown
    acquireVsCodeApi?: () => unknown
  }
  const init = host.__millFrame ?? { theme: { mode: 'light', scheme: 'light' }, state: undefined, context: {} }
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const messageHandlers: ((msg: unknown) => void)[] = []
  const eventHandlers = new Map<string, ((payload: unknown) => void)[]>()
  let seq = 0
  let theme = init.theme
  let context = init.context
  let state = init.state
  let vsCodeAcquired = false

  const applyTheme = (next: { mode: string; scheme: string }, tokens?: string) => {
    theme = next
    const root = document.documentElement
    root.setAttribute('data-mill-theme', next.mode)
    root.setAttribute('data-mill-scheme', next.scheme)
    if (typeof tokens !== 'string') return
    let style = document.getElementById('mill-tokens')
    if (!style) {
      style = document.createElement('style')
      style.id = 'mill-tokens'
      document.head.appendChild(style)
    }
    style.textContent = tokens
  }

  const send = (msg: Envelope) => {
    msg.mill = 1
    window.parent.postMessage(msg, '*')
  }

  const subscribe = (list: ((payload: never) => void)[], fn: (payload: never) => void) => {
    list.push(fn)
    return () => {
      const at = list.indexOf(fn)
      if (at >= 0) list.splice(at, 1)
    }
  }

  const onHostEvent = (data: Envelope) => {
    if (data.event === 'theme:changed') applyTheme(data.payload as { mode: string; scheme: string }, data.tokens)
    if (data.event === 'ctx') context = data.payload as Record<string, unknown>
    for (const handler of (eventHandlers.get(data.event ?? '') ?? []).slice()) handler(data.payload)
  }

  const onReply = (data: Envelope) => {
    const id = data.id
    if (id === undefined) return
    const waiting = pending.get(id)
    if (!waiting) return
    pending.delete(id)
    if (data.ok) waiting.resolve(data.result)
    else waiting.reject(new Error(data.error ?? 'the call failed'))
  }

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return
    const data = event.data as Envelope | null
    if (!data || data.mill !== 1) return
    if (data.kind === 'event') onHostEvent(data)
    else if (data.kind === 'message') for (const handler of messageHandlers.slice()) handler(data.payload)
    else onReply(data)
  })

  const postMessage = (msg: unknown) => { send({ kind: 'message', payload: msg }) }
  const getState = () => state
  const setState = (next: unknown) => {
    state = next
    send({ kind: 'state', payload: next })
    return next
  }

  const api: Record<string, unknown> = {
    postMessage,
    getState,
    setState,
    onMessage: (fn: (msg: unknown) => void) => subscribe(messageHandlers as ((p: never) => void)[], fn as (p: never) => void),
    call: (method: string, ...args: unknown[]) => new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      send({ id, kind: 'call', method, args })
    }),
    on: (event: string, fn: (payload: unknown) => void) => {
      const list = eventHandlers.get(event) ?? []
      eventHandlers.set(event, list)
      return subscribe(list as ((p: never) => void)[], fn as (p: never) => void)
    },
  }
  Object.defineProperty(api, 'theme', { get: () => theme, enumerable: true })
  Object.defineProperty(api, 'context', { get: () => context, enumerable: true })
  Object.freeze(api)

  applyTheme(theme)
  host.acquireMillApi = () => api
  // The webview shape a widely-used editor's extension pages already
  // speak, verbatim, so a page written for one drops in unchanged:
  // three methods, and acquiring it twice throws.
  host.acquireVsCodeApi = () => {
    if (vsCodeAcquired) throw new Error('An instance of the VS Code API has already been acquired')
    vsCodeAcquired = true
    return Object.freeze({ postMessage, getState, setState })
  }
  send({ kind: 'ready' })
}

const BOOTSTRAP_SOURCE = `(${millFrameBootstrap.toString()})();`

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

function framePolicy(base: string): string {
  return [
    `default-src 'none'`,
    `script-src ${base} 'unsafe-inline' blob:`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base} data:`,
    `connect-src 'none'`,
    `frame-src 'none'`,
  ].join('; ')
}

// escapeForScript keeps an injected JSON literal from ending the
// <script> element that carries it.
function escapeForScript(json: string): string {
  return json.replace(/</g, '\\u003c')
}

// buildFrameSrcdoc prepends Mill's four head pieces to the plugin's own
// page. The pieces go FIRST so the policy governs every element after
// it and the bootstrap exists before the page's own script runs; the
// page keeps everything else it wrote, including its own <head>.
export function buildFrameSrcdoc(base: string, html: string, init: FrameInit, tokens: string): string {
  const head = [
    `<base href="${base}">`,
    `<meta http-equiv="Content-Security-Policy" content="${framePolicy(base)}">`,
    `<style id="mill-tokens">${tokens}</style>`,
    `<script>window.__millFrame=${escapeForScript(JSON.stringify(init))};${BOOTSTRAP_SOURCE}</script>`,
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
