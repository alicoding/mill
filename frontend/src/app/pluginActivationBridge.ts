import { Events } from '@wailsio/runtime'
import { getPluginView } from '../plugins/pluginViews'
import { getPluginCapture } from '../plugins/pluginCaptures'
import { subscribeExtensionSetting } from '../shared/extensionSettingsStore'
import type { ExtensionSettingDecl } from '../atlas/atlasNounRegistry'
import type { MillPluginAPI } from '../plugins/sdk'

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

const SIMPLE_DOORS = new Set<string>([
  'notify', 'storage.set', 'storage.delete', 'query', 'kinds', 'open', 'fetch',
  'content.createNote', 'content.createCard', 'content.updateCard', 'content.appendListRow', 'content.createList', 'content.setCardFields',
  'files.list', 'convert.htmlToMarkdown', 'convert.markdownToHtml', 'requestGuardedAction',
])

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
  // settingDecls is this plugin's OWN declared settings (the same
  // list its snapshot was built from), so a settings.onChange
  // subscription resolves the exact declaration the snapshot did.
  settingDecls: readonly ExtensionSettingDecl[]
  pendingCommandRuns: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  nextCallId: number
  subscriptions: Map<number, ActivationSubscription>
  nextSubId: number
}

export function createActivationFrameContext(frame: HTMLIFrameElement, pluginId: string, settingDecls: readonly ExtensionSettingDecl[]): ActivationFrameContext {
  return { frame, pluginId, alive: true, settingDecls, pendingCommandRuns: new Map(), nextCallId: 0, subscriptions: new Map(), nextSubId: 0 }
}

// teardownActivationFrameContext ends every live subscription and
// rejects any command run still waiting on a reply that will now never
// arrive -- a torn-down frame answers nothing again.
export function teardownActivationFrameContext(ctx: ActivationFrameContext): void {
  ctx.alive = false
  for (const sub of ctx.subscriptions.values()) sub.unsubscribe()
  ctx.subscriptions.clear()
  for (const pending of ctx.pendingCommandRuns.values()) pending.reject(new Error(`plugin ${ctx.pluginId}: its extension frame was torn down`))
  ctx.pendingCommandRuns.clear()
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
// settings.onChange (contract item 2): the host holds the real
// subscription, and forwards each firing as an event the frame routes
// by the subId this answers.
function subscribe(ctx: ActivationFrameContext, topic: { topic: 'contents:changed'; kinds?: string[] } | { topic: 'settings'; key: string }): { subId: number } {
  const subId = ++ctx.nextSubId
  const teardown = topic.topic === 'contents:changed'
    ? Events.On('mill-data-changed', (evt) => {
      const data = evt.data as { entity?: string; id?: string; kind?: string } | undefined
      if (data?.entity !== 'atlas') return
      if (topic.kinds && !topic.kinds.includes(data.kind ?? '')) return
      post(ctx, { mill: 1, kind: 'event', event: 'contents.changed', payload: { subId, id: data.id ?? '', kind: data.kind } })
    })
    : subscribeSettingsChange(ctx, subId, topic.key)
  ctx.subscriptions.set(subId, { unsubscribe: teardown })
  return { subId }
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
    case 'subscribe': return subscribe(ctx, first as { topic: 'contents:changed'; kinds?: string[] } | { topic: 'settings'; key: string })
    case 'unsubscribe': unsubscribe(ctx, (first as { subId: number }).subId); return true
    default: throw new Error(`${method} is not available in a frame`)
  }
}

export interface ActivationBridgeOptions {
  ctx: ActivationFrameContext
  api: MillPluginAPI
  onDone: () => void
  onError: (message: string) => void
}

// attachActivationBridge listens for one activation frame's messages
// until the returned disposer runs: a 'call' routes through
// callActivationMethod, a 'command.result' resolves the matching
// sendCommandRun promise, and the one-shot activation-done/error
// signals hand off to the orchestrator that created this frame.
export function attachActivationBridge(options: ActivationBridgeOptions): () => void {
  const { ctx, api } = options
  const onMessage = (event: MessageEvent) => {
    if (event.source !== ctx.frame.contentWindow) return
    const data = event.data as { mill?: number; kind?: string; id?: number; callId?: number; ok?: boolean; result?: unknown; error?: string; method?: string; args?: unknown[] } | null
    if (!data || data.mill !== 1) return
    if (data.kind === 'activation-done') { options.onDone(); return }
    if (data.kind === 'activation-error') { options.onError(data.error ?? 'activation failed'); return }
    if (data.kind === 'command.result' && typeof data.callId === 'number') {
      const pending = ctx.pendingCommandRuns.get(data.callId)
      if (!pending) return
      ctx.pendingCommandRuns.delete(data.callId)
      if (data.ok) pending.resolve(undefined)
      else pending.reject(new Error(data.error || 'the command failed'))
      return
    }
    if (data.kind !== 'call' || typeof data.id !== 'number') return
    const id = data.id
    void callActivationMethod(ctx, api, String(data.method), data.args ?? [])
      .then((result) => post(ctx, { mill: 1, id, ok: true, result }))
      .catch((err: unknown) => post(ctx, { mill: 1, id, ok: false, error: err instanceof Error ? err.message : String(err) }))
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
