import { Events } from '@wailsio/runtime'
import { getPluginView } from '../plugins/pluginViews'
import { getPluginCapture } from '../plugins/pluginCaptures'
import { subscribeExtensionSetting } from '../shared/extensionSettingsStore'
import type { ExtensionSettingDecl } from '../atlas/atlasNounRegistry'
import type { MillPluginAPI } from '../plugins/sdk'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { callExportedMethod, toWireDescriptor } from '../plugins/extensionExports'
import { CANVAS_TOOL_DOORS, callCanvasToolDoor, forgetCanvasTools } from '../plugins/canvasToolHostDoors'

// The host half of a third-party plugin's activation frame (docs/
// goals/0375 S1b): the same envelope pluginFrameBridge.ts's entry-page
// bridge uses (a whitelisted 'call' awaiting a reply), over a wider
// door table -- an activation frame may REGISTER contributions, not
// just call doors an already-built plugin holds.
//
// The doors below are answered directly against `api` rather than by
// importing pluginFrameBridge.ts's own callFrameMethod: that module
// imports shared/commands.ts (for its 'runCommand' door), and
// shared/commands.ts snapshots the tool registry at eval
// (loader.ts's own IMPORT DISCIPLINE) -- pulling it into THIS module
// would pull it into the loader's import graph too, since an
// activation frame's bridge is attached before the app's own module
// graph may evaluate. The routing below is the same one-line-per-door
// shape, just answered locally.
//
// The frame's origin is opaque, so identity is `event.source ===
// frame.contentWindow`, exactly as the entry-page bridge establishes.

function callSimpleDoor(api: MillPluginAPI, method: string, args: unknown[]): Promise<unknown> | unknown {
  const [first, second, third] = args
  switch (method) {
    case 'notify': return api.notify(first as Parameters<MillPluginAPI['notify']>[0])
    case 'storage.set': return api.storage.set(String(first), second)
    case 'storage.delete': return api.storage.delete(String(first))
    case 'query': return api.query(first as Parameters<MillPluginAPI['query']>[0])
    case 'kinds': return api.kinds()
    case 'open': { api.open(String(first)); return undefined }
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
    default: return undefined
  }
}

// Exported (goal 0396) so the plugin-frame runtime's own build
// (frontend/src/plugin-frame/activation.ts) can be checked against
// this SAME list instead of drifting from it by hand -- the byte-
// parity test a hand-copied frame runtime used to need.
export const SIMPLE_DOORS = new Set<string>([
  'notify', 'storage.set', 'storage.delete', 'query', 'kinds', 'open', 'fetch',
  'content.createNote', 'content.createCard', 'content.updateCard', 'content.appendListRow', 'content.createList', 'content.setCardFields',
  'files.list', 'convert.htmlToMarkdown', 'convert.markdownToHtml', 'requestGuardedAction',
])

// ACTIVATION_ONLY_METHODS is every door callActivationMethod answers
// that is NOT in SIMPLE_DOORS: an activation frame may register
// contributions and relay view/capture messages, doors an entry-page
// frame's own callFrameMethod (pluginFrameBridge.ts) never needs. Keep
// this list equal to the case labels callActivationMethod's own switch
// below answers -- the plugin-frame protocol test enforces it.
export const ACTIVATION_ONLY_METHODS = [
  'register.command', 'register.view', 'register.capture',
  'view.postMessage', 'capture.postMessage',
  'subscribe', 'unsubscribe',
  'extensions.get', 'extensions.call',
  // The framed canvas contract (docs/goals/0380): a tool declares
  // itself, draws through drafts, measures off the board, and erases
  // through the host -- CANVAS_TOOL_DOORS is that whole list, owned by
  // canvasToolHostDoors.ts so the routing below stays one line.
  ...CANVAS_TOOL_DOORS,
] as const

interface ActivationSubscription {
  unsubscribe: () => void
}

// ActivationFrameContext is one activated plugin's live state: the
// frame it runs in, whether it can still be asked to do anything (a
// command's own `enabled` predicate is exactly this -- "honest: false
// while the frame is not alive"), and every pending reverse call a
// registered command's run() is waiting on.
export interface ActivationFrameContext {
  frame: HTMLIFrameElement
  pluginId: string
  alive: boolean
  // manifest is what the canvas-tool doors check a capability and an
  // ingestion claim against (docs/goals/0380) -- carried here because a
  // framed plugin's own JS never holds its manifest.
  manifest: Manifest
  // settingDecls is this plugin's OWN declared settings (the same
  // list its snapshot was built from), so a settings.onChange
  // subscription resolves the exact declaration the snapshot did.
  settingDecls: readonly ExtensionSettingDecl[]
  pendingCommandRuns: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  // pendingExtensionCalls is sendExtensionCall's own pending table
  // (goal 0364) -- the reverse-call twin of pendingCommandRuns, for
  // when THIS plugin is a dependant's dependency and one of its
  // exported methods is being invoked from outside.
  pendingExtensionCalls: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  nextCallId: number
  subscriptions: Map<number, ActivationSubscription>
  nextSubId: number
}

export function createActivationFrameContext(frame: HTMLIFrameElement, pluginId: string, settingDecls: readonly ExtensionSettingDecl[], manifest: Manifest): ActivationFrameContext {
  return { frame, pluginId, alive: true, manifest, settingDecls, pendingCommandRuns: new Map(), pendingExtensionCalls: new Map(), nextCallId: 0, subscriptions: new Map(), nextSubId: 0 }
}

// teardownActivationFrameContext ends every live subscription and
// rejects any command run still waiting on a reply that will now never
// arrive -- a torn-down frame answers nothing again.
export function teardownActivationFrameContext(ctx: ActivationFrameContext): void {
  ctx.alive = false
  forgetCanvasTools(ctx.pluginId)
  for (const sub of ctx.subscriptions.values()) sub.unsubscribe()
  ctx.subscriptions.clear()
  for (const pending of ctx.pendingCommandRuns.values()) pending.reject(new Error(`plugin ${ctx.pluginId}: its extension frame was torn down`))
  ctx.pendingCommandRuns.clear()
  for (const pending of ctx.pendingExtensionCalls.values()) pending.reject(new Error(`Extension ${ctx.pluginId} is not running.`))
  ctx.pendingExtensionCalls.clear()
}

function post(ctx: ActivationFrameContext, message: unknown): void {
  ctx.frame.contentWindow?.postMessage(message, '*')
}

// sendCommandRun asks the frame to run one of ITS OWN registered
// commands and resolves once the frame answers -- the reverse of the
// frame's own 'call': the frame is the callee here.
function sendCommandRun(ctx: ActivationFrameContext, id: string, args: unknown[]): Promise<void> {
  if (!ctx.alive) return Promise.reject(new Error(`plugin ${ctx.pluginId}: its extension is not running`))
  return new Promise((resolve, reject) => {
    const callId = ++ctx.nextCallId
    ctx.pendingCommandRuns.set(callId, { resolve: () => resolve(), reject })
    post(ctx, { mill: 1, kind: 'command.run', callId, id, args })
  })
}

// EXTENSION_CALL_TIMEOUT_MS is design contract item 4's "10 s per
// call": a framed callee that never answers -- hung, or torn down
// without the teardown path running -- must not leave the caller's
// promise pending forever. A dead frame and a timed-out one read the
// same to the caller, since neither tells it anything more specific.
const EXTENSION_CALL_TIMEOUT_MS = 10_000

// sendExtensionCall asks this frame's OWN activation to run one method
// off the object its activate() returned (goal 0364) -- the reverse
// round trip callExportedMethod takes when the exporting extension is
// framed, exactly the shape sendCommandRun already established.
export function sendExtensionCall(ctx: ActivationFrameContext, method: string, args: unknown[]): Promise<unknown> {
  if (!ctx.alive) return Promise.reject(new Error(`Extension ${ctx.pluginId} is not running.`))
  return new Promise((resolve, reject) => {
    const callId = ++ctx.nextCallId
    const timer = setTimeout(() => {
      if (ctx.pendingExtensionCalls.delete(callId)) reject(new Error(`Extension ${ctx.pluginId} is not running.`))
    }, EXTENSION_CALL_TIMEOUT_MS)
    ctx.pendingExtensionCalls.set(callId, {
      resolve: (v) => { clearTimeout(timer); resolve(v) },
      reject: (e) => { clearTimeout(timer); reject(e) },
    })
    post(ctx, { mill: 1, kind: 'extension.call', callId, method, args })
  })
}

// registerFramedCommand seats a registry command whose run() and
// enabled() both answer the activation frame's own truth: run() awaits
// the frame's registered handler, and enabled() is exactly the
// frame's aliveness -- a plugin's own predicate cannot cross the
// boundary synchronously, so aliveness is the one honest signal a
// framed command's enablement can carry.
function registerFramedCommand(ctx: ActivationFrameContext, api: MillPluginAPI, descriptor: { id: string; label: string }): void {
  api.registerCommand({
    id: descriptor.id,
    label: descriptor.label,
    run: () => sendCommandRun(ctx, descriptor.id, []),
    enabled: () => ctx.alive,
  })
}

// registerFramedView/registerFramedCapture attach the plugin's own
// onMessage the way hostApi.ts's registerView/registerCapture already
// do for an entry-declared surface; the returned handle is discarded
// here because view.postMessage/capture.postMessage below reach the
// SAME mounted surface through getPluginView/getPluginCapture instead
// -- there may be no view or capture frame open at all yet, so a
// stored handle from registration time would go stale the moment one
// closes and reopens.
function registerFramedView(ctx: ActivationFrameContext, api: MillPluginAPI, descriptor: { id: string; hasMessageHandler: boolean }): void {
  api.registerView({
    id: descriptor.id,
    onMessage: descriptor.hasMessageHandler ? (message) => post(ctx, { mill: 1, kind: 'event', event: 'view.message', payload: { id: descriptor.id, payload: message } }) : undefined,
  })
}

function registerFramedCapture(ctx: ActivationFrameContext, api: MillPluginAPI, descriptor: { id: string; hasMessageHandler: boolean }): void {
  api.registerCapture({
    id: descriptor.id,
    onMessage: descriptor.hasMessageHandler ? (message) => post(ctx, { mill: 1, kind: 'event', event: 'capture.message', payload: { id: descriptor.id, payload: message } }) : undefined,
  })
}

// subscribe is the door behind on('contents:changed') and
// settings.onChange (contract item 2); 'entity.*'/'object.*' answer the
// lifecycle family the same way (docs/goals/0392 S2): the host holds
// the real subscription, and forwards each firing as an event the
// frame routes by the subId this answers.
function subscribe(ctx: ActivationFrameContext, topic: SubscribeTopic): { subId: number } {
  const subId = ++ctx.nextSubId
  let teardown: () => void
  switch (topic.topic) {
    case 'contents:changed':
      teardown = subscribeContentsChanged(ctx, subId, topic.kinds)
      break
    case 'entity.*':
    case 'object.*':
      teardown = subscribeLifecycleEvent(ctx, subId, topic.topic, topic.kinds)
      break
    default:
      teardown = subscribeSettingsChange(ctx, subId, topic.key)
  }
  ctx.subscriptions.set(subId, { unsubscribe: teardown })
  return { subId }
}

type SubscribeTopic =
  | { topic: 'contents:changed'; kinds?: string[] }
  | { topic: 'entity.*' | 'object.*'; kinds?: string[] }
  | { topic: 'settings'; key: string }

function subscribeContentsChanged(ctx: ActivationFrameContext, subId: number, kinds: string[] | undefined): () => void {
  return Events.On('mill-data-changed', (evt) => {
    const data = evt.data as { entity?: string; id?: string; kind?: string } | undefined
    if (data?.entity !== 'atlas') return
    if (kinds && !kinds.includes(data.kind ?? '')) return
    post(ctx, { mill: 1, kind: 'event', event: 'contents.changed', payload: { subId, id: data.id ?? '', kind: data.kind } })
  })
}

// subscribeLifecycleEvent answers 'entity.*'/'object.*' (docs/goals/0392
// S2): one wire event carries the whole lifecycle family, discriminated
// by its own `event` field; kinds narrows by entityKind for entity.*
// and by the object's own kind for object.*, mirroring hostApi.ts's
// same-DOM implementation of this same topic.
function subscribeLifecycleEvent(ctx: ActivationFrameContext, subId: number, topic: 'entity.*' | 'object.*', kinds: string[] | undefined): () => void {
  const prefix = topic === 'entity.*' ? 'entity.' : 'object.'
  const kindField = topic === 'entity.*' ? 'entityKind' : 'kind'
  return Events.On('mill-lifecycle-event', (evt) => {
    const data = evt.data as Record<string, unknown> & { event?: string } | undefined
    if (!data?.event?.startsWith(prefix)) return
    if (kinds && !kinds.includes((data[kindField] as string | undefined) ?? '')) return
    post(ctx, { mill: 1, kind: 'event', event: 'lifecycle.event', payload: { subId, ...data } })
  })
}

// subscribeSettingsChange resolves the key against THIS plugin's own
// declared settings (settingDecls, carried on the context since a
// framed plugin's own JS never holds the manifest) -- an undeclared
// key subscribes to nothing, the same fail-quiet a stale key would get
// were it never renamed on the still-running side.
function subscribeSettingsChange(ctx: ActivationFrameContext, subId: number, key: string): () => void {
  const decl = ctx.settingDecls.find((d) => d.key === key)
  if (!decl) return () => {}
  return subscribeExtensionSetting(ctx.pluginId, decl, (value) => {
    post(ctx, { mill: 1, kind: 'event', event: 'settings.changed', payload: { subId, key, value } })
  })
}

function unsubscribe(ctx: ActivationFrameContext, subId: number): void {
  ctx.subscriptions.get(subId)?.unsubscribe()
  ctx.subscriptions.delete(subId)
}

// callActivationMethod routes one whitelisted call from an activation
// frame: the doors every framed page already reaches (callSimpleDoor)
// plus the registration doors that turn a plugin's own registerX calls
// into real host-side registrations.
export async function callActivationMethod(ctx: ActivationFrameContext, api: MillPluginAPI, method: string, args: unknown[]): Promise<unknown> {
  if (SIMPLE_DOORS.has(method)) return callSimpleDoor(api, method, args)
  const [first] = args
  switch (method) {
    case 'register.command': registerFramedCommand(ctx, api, first as { id: string; label: string }); return true
    case 'register.view': registerFramedView(ctx, api, first as { id: string; hasMessageHandler: boolean }); return true
    case 'register.capture': registerFramedCapture(ctx, api, first as { id: string; hasMessageHandler: boolean }); return true
    case 'view.postMessage': { const { id, payload } = first as { id: string; payload: unknown }; getPluginView(ctx.pluginId, id)?.post?.(payload); return true }
    case 'capture.postMessage': { const { id, payload } = first as { id: string; payload: unknown }; getPluginCapture(ctx.pluginId, id)?.post?.(payload); return true }
    case 'subscribe': return subscribe(ctx, first as SubscribeTopic)
    case 'unsubscribe': unsubscribe(ctx, (first as { subId: number }).subId); return true
    // extensions.get/extensions.call (goal 0364): the wire-safe twin
    // of MillPluginAPI['extensions']['get'] -- a live function cannot
    // cross postMessage, so 'extensions.get' answers plain {data,
    // methods} instead of api.extensions.get's own callable stubs, and
    // 'extensions.call' is how a framed caller actually invokes one of
    // those method names.
    case 'extensions.get': return toWireDescriptor(await api.extensions.get(String(first)))
    case 'extensions.call': return callExtensionExportDoor(api, args as [string, string, unknown[] | undefined])
    default:
      if ((CANVAS_TOOL_DOORS as readonly string[]).includes(method)) {
        return callCanvasToolDoor({ pluginId: ctx.pluginId, manifest: ctx.manifest, post: (event, payload) => post(ctx, { mill: 1, kind: 'event', event, payload }) }, method, args)
      }
      throw new Error(`${method} is not available in a frame`)
  }
}

// callExtensionExportDoor is 'extensions.call's own body, split out so
// the switch above stays flat: it re-runs api.extensions.get's own
// gate (declared dependency, activated) rather than trusting that the
// frame only ever asks for what it was handed.
async function callExtensionExportDoor(api: MillPluginAPI, [depId, exportMethod, callArgs]: [string, string, unknown[] | undefined]): Promise<unknown> {
  const view = await api.extensions.get(String(depId))
  if (!view) throw new Error(`Method ${exportMethod} is not exported by ${depId}.`)
  return callExportedMethod(String(depId), String(exportMethod), callArgs ?? [])
}

export interface ActivationBridgeOptions {
  ctx: ActivationFrameContext
  api: MillPluginAPI
  // exported carries what activate() returned, split by the frame's
  // own activation.js into wire-safe data/method-name shape (goal
  // 0364) -- undefined for a frame running before this slice, or one
  // whose activate() returned nothing.
  onDone: (exported?: { data: Record<string, unknown>; methods: string[] }) => void
  onError: (message: string) => void
}

// attachActivationBridge listens for one activation frame's messages
// until the returned disposer runs: a 'call' routes through
// callActivationMethod, a 'command.result'/'extension.result' resolves
// the matching reverse-call promise, and the one-shot activation-done/
// error signals hand off to the orchestrator that created this frame.
type ActivationMessage = { mill?: number; kind?: string; id?: number; callId?: number; ok?: boolean; result?: unknown; error?: string; method?: string; args?: unknown[]; exports?: { data: Record<string, unknown>; methods: string[] } }

// settleReverseCall resolves or rejects one pending reverse call --
// sendCommandRun's 'command.result' and sendExtensionCall's
// 'extension.result' answer the SAME shape, so both settle through
// this one function instead of two near-identical blocks.
function settleReverseCall(pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>, data: ActivationMessage, failureNoun: string): void {
  if (typeof data.callId !== 'number') return
  const entry = pending.get(data.callId)
  if (!entry) return
  pending.delete(data.callId)
  if (data.ok) entry.resolve(data.result)
  else entry.reject(new Error(data.error || `the ${failureNoun} failed`))
}

export function attachActivationBridge(options: ActivationBridgeOptions): () => void {
  const { ctx, api } = options
  const onMessage = (event: MessageEvent) => {
    if (event.source !== ctx.frame.contentWindow) return
    const data = event.data as ActivationMessage | null
    if (!data || data.mill !== 1) return
    if (data.kind === 'activation-done') { options.onDone(data.exports); return }
    if (data.kind === 'activation-error') { options.onError(data.error ?? 'activation failed'); return }
    if (data.kind === 'command.result') { settleReverseCall(ctx.pendingCommandRuns, data, 'command'); return }
    if (data.kind === 'extension.result') { settleReverseCall(ctx.pendingExtensionCalls, data, 'call'); return }
    if (data.kind !== 'call' || typeof data.id !== 'number') return
    const id = data.id
    void callActivationMethod(ctx, api, String(data.method), data.args ?? [])
      .then((result) => post(ctx, { mill: 1, id, ok: true, result }))
      .catch((err: unknown) => post(ctx, { mill: 1, id, ok: false, error: err instanceof Error ? err.message : String(err) }))
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
