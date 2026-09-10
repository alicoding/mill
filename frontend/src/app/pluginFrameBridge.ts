import { runCommand } from '../shared/commands'
import { resolveCommandForCombo } from '../shared/commandDispatch'
import type { KeyCombo } from '../shared/keybinding'
import { useAppStore } from '../shared/store'
import type { MillPluginAPI } from '../plugins/sdk'
import type { GuardedActionResult } from '../plugins/sdk/guardedAction'
import { callExportedMethod, toWireDescriptor } from '../plugins/extensionExports'

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

// FaceControls are the two things a canvas object's framed face can ask
// for that a view cannot (goal 0349 S6): a payload write on ITS object,
// and the editing signal that stands the board's shortcuts down.
export interface FaceControls {
  updatePayload: (patch: Record<string, string>) => Promise<void>
  setEditing: (editing: boolean) => void
}

// GuardedWriteControls is the inline "ask" confirmation door (goal
// 0374): a write's "ask" outcome is resolved by a banner the HOST
// renders outside the sandboxed frame, never by the frame itself — the
// frame may request performGuardedAction, but only the host's own
// click handler can ever set confirmed=true on the call underneath it.
export interface GuardedWriteControls {
  perform: (kind: string, attributes: Record<string, string>, description: string) => Promise<GuardedActionResult>
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
  'kinds',
  'links',
  'linkKinds',
  'open',
  'fetch',
  'content.createNote',
  'content.createCard',
  'content.updateCard',
  'content.appendListRow',
  'content.createList',
  'content.setCardFields',
  'files.list',
  'convert.htmlToMarkdown',
  'convert.markdownToHtml',
  'requestGuardedAction',
  'evaluateGuardedAction',
  'callIntegration',
  'performGuardedAction',
  'context.set',
  'runCommand',
  'capture.done',
  'capture.cancel',
  'object.updatePayload',
  'object.setEditing',
  // extensions.get/extensions.call (goal 0364): api.extensions.get's
  // wire-safe twin -- see pluginActivationBridge.ts's identical pair
  // for the full contract; a live stub function cannot cross
  // postMessage, so 'extensions.get' answers {data, methods} and
  // 'extensions.call' is how the frame invokes one of those names.
  'extensions.get',
  'extensions.call',
] as const

export type FrameMethod = typeof FRAME_METHODS[number]

const ALLOWED = new Set<string>(FRAME_METHODS)

// callFrameMethod routes one whitelisted call onto the plugin's own api
// object. notify answers true rather than its dismiss function, which
// is a function and cannot cross the boundary; every other reply is
// already plain data.
export async function callFrameMethod(api: MillPluginAPI, method: string, args: unknown[], capture?: CaptureControls, face?: FaceControls, guardedWrite?: GuardedWriteControls): Promise<unknown> {
  if (!ALLOWED.has(method)) throw new Error(`${method} is not available in a frame`)
  if (method.startsWith('object.') && !face) throw new Error(`${method} is only available in a canvas object's face`)
  if (method === 'performGuardedAction' && !guardedWrite) throw new Error(`${method} is not available in this frame`)
  const [first, second, third] = args
  switch (method as FrameMethod) {
    case 'settings.get': return api.settings.get(String(first))
    case 'notify': { api.notify(first as Parameters<MillPluginAPI['notify']>[0]); return true }
    case 'storage.get': return api.storage.get(String(first))
    case 'storage.set': { await api.storage.set(String(first), second); return true }
    case 'storage.delete': { await api.storage.delete(String(first)); return true }
    case 'query': return api.query(first as Parameters<MillPluginAPI['query']>[0])
    case 'kinds': return api.kinds()
    case 'links': return api.links(first as Parameters<MillPluginAPI['links']>[0])
    case 'linkKinds': return api.linkKinds()
    case 'open': { api.open(String(first)); return true }
    case 'fetch': return api.fetch(String(first), second as Parameters<MillPluginAPI['fetch']>[1])
    case 'content.createNote': return api.content.createNote(first as Parameters<MillPluginAPI['content']['createNote']>[0])
    case 'content.createCard': return api.content.createCard(first as Parameters<MillPluginAPI['content']['createCard']>[0])
    case 'content.updateCard': return api.content.updateCard(String(first), second as Parameters<MillPluginAPI['content']['updateCard']>[1])
    case 'content.appendListRow': return api.content.appendListRow(String(first), second as Record<string, string>)
    case 'content.createList': return api.content.createList(first as Parameters<MillPluginAPI['content']['createList']>[0])
    case 'content.setCardFields': return api.content.setCardFields(String(first), second as Record<string, string>)
    case 'files.list': return api.files.list(String(first))
    case 'convert.htmlToMarkdown': return api.convert.htmlToMarkdown(String(first))
    case 'convert.markdownToHtml': return api.convert.markdownToHtml(String(first))
    case 'requestGuardedAction': return api.requestGuardedAction(String(first), second as Record<string, string>, String(third))
    case 'context.set': { api.context.set(String(first), second as Parameters<MillPluginAPI['context']['set']>[1]); return true }
    case 'evaluateGuardedAction': return api.evaluateGuardedAction(String(first), second as Record<string, string>)
    case 'callIntegration': return api.callIntegration(String(first), String(second), String(third), args[3] as Record<string, string>)
    // Never api.<anything>: performGuardedAction's "ask" outcome is
    // resolved by the host's OWN banner, so it is never reachable
    // through the generic api object at all (goal 0374 amendment 1) —
    // guardedWrite is the one and only door, and its perform never
    // accepts a confirmed flag from this call's args.
    case 'performGuardedAction': return guardedWrite!.perform(String(first), second as Record<string, string>, String(third))
    // The registry's own door, with the registry's own honest
    // enablement: an unknown id or a command whose enabled() says no
    // answers false, exactly as every other invoker sees it.
    case 'runCommand': return runCommand(String(first))
    case 'capture.done': { capture?.done(); return true }
    case 'capture.cancel': { capture?.cancel(); return true }
    case 'object.updatePayload': { await face?.updatePayload(first as Record<string, string>); return true }
    case 'object.setEditing': { face?.setEditing(!!first); return true }
    case 'extensions.get': return toWireDescriptor(await api.extensions.get(String(first)))
    case 'extensions.call': return callExtensionExportDoor(api, args as [string, string, unknown[] | undefined])
  }
}

// callExtensionExportDoor is 'extensions.call's own body (goal 0364),
// split out so the switch above stays flat -- see
// pluginActivationBridge.ts's identical helper for the full contract.
async function callExtensionExportDoor(api: MillPluginAPI, [depId, exportMethod, callArgs]: [string, string, unknown[] | undefined]): Promise<unknown> {
  const view = await api.extensions.get(String(depId))
  if (!view) throw new Error(`Method ${exportMethod} is not exported by ${depId}.`)
  return callExportedMethod(String(depId), String(exportMethod), callArgs ?? [])
}

export interface FrameBridgeOptions {
  frame: HTMLIFrameElement
  api: MillPluginAPI
  capture?: CaptureControls
  face?: FaceControls
  guardedWrite?: GuardedWriteControls
  /** Allows only the source-checked palette shortcut adapter. */
  paletteAccess?: boolean
  /** Called with what the page sent through its postMessage door. */
  onPageMessage?: (payload: unknown) => void
  /** Called with the value the page's setState persisted. */
  onState?: (state: unknown) => void
  /** Called once the page's bootstrap has announced itself. */
  onReady?: () => void
}

function framePaletteCombo(value: unknown): KeyCombo | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { mods?: unknown; key?: unknown }
  if (!Array.isArray(candidate.mods) || typeof candidate.key !== 'string' || candidate.key === '') return null
  const allowed = new Set(['cmd', 'ctrl', 'shift', 'option'])
  if (!candidate.mods.every((mod) => typeof mod === 'string' && allowed.has(mod))) return null
  if (new Set(candidate.mods).size !== candidate.mods.length) return null
  return { mods: [...candidate.mods] as string[], key: candidate.key }
}

function frameIsHidden(frame: HTMLIFrameElement): boolean {
  for (let node: HTMLElement | null = frame; node; node = node.parentElement) {
    if (node.hidden) return true
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return true
  }
  return false
}

// A frame message is only a request to re-check current host truth. It
// acts when this exact live frame owns focus and the current resolver
// still gives the combo to palette.open; no other command is reachable.
export function handleFramePaletteShortcut(options: FrameBridgeOptions, payload: unknown): boolean {
  const { frame } = options
  if (!options.paletteAccess || !frame.isConnected || frameIsHidden(frame)) return false
  if (document.activeElement !== frame) return false
  const combo = framePaletteCombo(payload)
  if (!combo) return false
  const state = useAppStore.getState()
  const resolved = resolveCommandForCombo(combo, state.keybindingOverrides, state.view.kind)
  if (resolved?.command.id !== 'palette.open') return false
  void runCommand('palette.open', resolved.context)
  return true
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
  if (data.kind === 'palette-shortcut') { handleFramePaletteShortcut(options, data.payload); return }
  if (data.kind !== 'call' || typeof data.id !== 'number') return
  const id = data.id
  void callFrameMethod(api, String(data.method), data.args ?? [], options.capture, options.face, options.guardedWrite)
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
