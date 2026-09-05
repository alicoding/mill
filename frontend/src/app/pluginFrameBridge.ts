import { runCommand } from '../shared/commands'
import type { MillPluginAPI } from '../plugins/sdk'

// The host half of the plugin frame's channel (docs/goals/0349),
// composed from the shape the embedded-editor protocol already proved
// here (atlas/drawioEmbedProtocol.ts): one envelope, one source check,
// a pure router the tests drive without a DOM.
//
// The frame's origin is opaque, so `event.origin` is the string "null"
// for every message it sends and can never identify it. Identity is
// `event.source === frame.contentWindow` instead: a window reference
// no other document can forge.

export interface FrameEnvelope {
  mill?: number
  id?: number
  kind?: string
  method?: string
  args?: unknown[]
  payload?: unknown
}

export interface FrameReply {
  mill: 1
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

export interface FrameEvent {
  mill: 1
  kind: 'event'
  event: string
  payload: unknown
  tokens?: string
}

// CaptureControls are the two things a capture's frame can ask for that
// a view's cannot: closing the capture window, with or without having
// written anything.
export interface CaptureControls {
  done: () => void
  cancel: () => void
}

// FRAME_METHODS is the whole surface a framed page can reach. It is a
// deliberate subset of the plugin api: anything that hands back a
// function, an element or a live object cannot cross a postMessage
// boundary, and anything the frame has no business driving stays out.
// A method not listed here is refused by name, never silently ignored.
export const FRAME_METHODS = [
  'settings.get',
  'notify',
  'storage.get',
  'storage.set',
  'storage.delete',
  'query',
  'fetch',
  'content.createNote',
  'content.createCard',
  'content.updateCard',
  'content.appendListRow',
  'content.createList',
  'files.list',
  'convert.htmlToMarkdown',
  'requestGuardedAction',
  'runCommand',
  'capture.done',
  'capture.cancel',
] as const

export type FrameMethod = typeof FRAME_METHODS[number]

const ALLOWED = new Set<string>(FRAME_METHODS)

// callFrameMethod routes one whitelisted call onto the plugin's own api
// object. notify answers true rather than its dismiss function, which
// is a function and cannot cross the boundary; every other reply is
// already plain data.
export async function callFrameMethod(api: MillPluginAPI, method: string, args: unknown[], capture?: CaptureControls): Promise<unknown> {
  if (!ALLOWED.has(method)) throw new Error(`${method} is not available in a frame`)
  const [first, second, third] = args
  switch (method as FrameMethod) {
    case 'settings.get': return api.settings.get(String(first))
    case 'notify': { api.notify(first as Parameters<MillPluginAPI['notify']>[0]); return true }
    case 'storage.get': return api.storage.get(String(first))
    case 'storage.set': { await api.storage.set(String(first), second); return true }
    case 'storage.delete': { await api.storage.delete(String(first)); return true }
    case 'query': return api.query(first as Parameters<MillPluginAPI['query']>[0])
    case 'fetch': return api.fetch(String(first), second as Parameters<MillPluginAPI['fetch']>[1])
    case 'content.createNote': return api.content.createNote(first as Parameters<MillPluginAPI['content']['createNote']>[0])
    case 'content.createCard': return api.content.createCard(first as Parameters<MillPluginAPI['content']['createCard']>[0])
    case 'content.updateCard': return api.content.updateCard(String(first), second as Parameters<MillPluginAPI['content']['updateCard']>[1])
    case 'content.appendListRow': return api.content.appendListRow(String(first), second as Record<string, string>)
    case 'content.createList': return api.content.createList(first as Parameters<MillPluginAPI['content']['createList']>[0])
    case 'files.list': return api.files.list(String(first))
    case 'convert.htmlToMarkdown': return api.convert.htmlToMarkdown(String(first))
    case 'requestGuardedAction': return api.requestGuardedAction(String(first), second as Record<string, string>, String(third))
    // The registry's own door, with the registry's own honest
    // enablement: an unknown id or a command whose enabled() says no
    // answers false, exactly as every other invoker sees it.
    case 'runCommand': return runCommand(String(first))
    case 'capture.done': { capture?.done(); return true }
    case 'capture.cancel': { capture?.cancel(); return true }
  }
}

export interface FrameBridgeOptions {
  frame: HTMLIFrameElement
  api: MillPluginAPI
  capture?: CaptureControls
  /** Called with what the page sent through its postMessage door. */
  onPageMessage?: (payload: unknown) => void
  /** Called with the value the page's setState persisted. */
  onState?: (state: unknown) => void
  /** Called once the page's bootstrap has announced itself. */
  onReady?: () => void
}

// handleFrameMessage is the whole routing decision, kept free of the
// listener so a test drives it with a plain object. A message whose
// source is not this frame's own window is dropped before anything
// else is read: the frame's origin is opaque, so identity is the
// window reference or nothing.
export function handleFrameMessage(options: FrameBridgeOptions, event: Pick<MessageEvent, 'source' | 'data'>): void {
  const { frame, api } = options
  if (event.source !== frame.contentWindow) return
  const data = event.data as FrameEnvelope | null
  if (!data || data.mill !== 1) return
  if (data.kind === 'ready') { options.onReady?.(); return }
  if (data.kind === 'message') { options.onPageMessage?.(data.payload); return }
  if (data.kind === 'state') { options.onState?.(data.payload); return }
  if (data.kind !== 'call' || typeof data.id !== 'number') return
  const id = data.id
  void callFrameMethod(api, String(data.method), data.args ?? [], options.capture)
    .then((result) => reply(frame, { mill: 1, id, ok: true, result }))
    .catch((err: unknown) => reply(frame, { mill: 1, id, ok: false, error: err instanceof Error ? err.message : String(err) }))
}

// attachFrameBridge listens for one frame's messages until the returned
// disposer runs. Every reply and event is addressed to that frame's own
// contentWindow, so a disposed bridge can never answer a later frame.
export function attachFrameBridge(options: FrameBridgeOptions): () => void {
  const onMessage = (event: MessageEvent) => handleFrameMessage(options, event)
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}

function reply(frame: HTMLIFrameElement, message: FrameReply): void {
  frame.contentWindow?.postMessage(message, '*')
}

// sendFrameEvent is the host -> page direction: the theme changing, a
// setting changing, the board's contents changing, the surface's own
// context, and the box the page is drawn in resizing.
export function sendFrameEvent(frame: HTMLIFrameElement | null, event: string, payload: unknown, tokens?: string): void {
  frame?.contentWindow?.postMessage({ mill: 1, kind: 'event', event, payload, tokens } satisfies FrameEvent, '*')
}

// sendFrameMessage relays what the plugin's own code posted into the
// page, the other half of the page's postMessage door.
export function sendFrameMessage(frame: HTMLIFrameElement | null, payload: unknown): void {
  frame?.contentWindow?.postMessage({ mill: 1, kind: 'message', payload }, '*')
}
