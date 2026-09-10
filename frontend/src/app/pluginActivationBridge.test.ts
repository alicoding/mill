// @vitest-environment jsdom
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachActivationBridge, callActivationMethod, createActivationFrameContext, sendExtensionCall, teardownActivationFrameContext } from './pluginActivationBridge'
import { collectPluginCapture, getPluginCapture, setPluginCaptureSink, unregisterPluginCaptures } from '../plugins/pluginCaptures'
import { collectPluginView, getPluginView, setPluginViewSink, unregisterPluginViews } from '../plugins/pluginViews'
import { pluginContextFacts, setPluginContextKey } from '../plugins/pluginContextKeys'
import type { MillPluginAPI } from '../plugins/sdk'

// The manifest a framed context now carries (docs/goals/0380): the
// canvas-tool doors check a capability and an ingestion claim against
// it, and every case below drives a plugin that declares neither.
const PROBE_MANIFEST = { id: 'framed-probe', name: 'Framed probe', version: '1.0.0', description: '', author: '', minMillVersion: '', icon: '', capabilities: [], dependencies: [], exports: [], contributes: {} } as unknown as Manifest

// The activation bridge is a third-party plugin's ONLY door into its
// registrations while it runs framed (docs/goals/0375 S1b): what it
// routes onto the host-side api, and how a registered command's run()
// and enabled() answer, matter as much as pluginFrameBridge.ts's own
// door table does for a view's page.

function fakeFrame() {
  const post = vi.fn()
  const contentWindow = { postMessage: post } as unknown as Window
  return { post, contentWindow, frame: { contentWindow } as unknown as HTMLIFrameElement }
}

function fakeApi(overrides: Partial<MillPluginAPI> = {}): MillPluginAPI {
  return {
    millVersion: '1.0.0',
    pluginId: 'framed-probe',
    registerCanvasObject: vi.fn(),
    registerCommand: vi.fn(),
    registerView: vi.fn(() => ({ postMessage: vi.fn() })),
    registerCapture: vi.fn(() => ({ postMessage: vi.fn() })),
    requestGuardedAction: vi.fn(async () => ({ approved: true, effect: '', ruleLabel: '', performed: true })),
    settings: { get: vi.fn(() => 'value'), onChange: vi.fn() },
    context: { set: vi.fn() },
    notify: vi.fn(() => () => {}),
    storage: { get: vi.fn(), set: vi.fn(async () => {}), delete: vi.fn(async () => {}), keys: vi.fn(() => []) },
    query: vi.fn(async () => []),
    kinds: vi.fn(async () => []),
    open: vi.fn(),
    on: vi.fn(() => () => {}),
    fetch: vi.fn(),
    fetchJSON: vi.fn(),
    content: { createNote: vi.fn(), createCard: vi.fn(), updateCard: vi.fn(), appendListRow: vi.fn(), createList: vi.fn(), setCardFields: vi.fn() },
    convert: { htmlToMarkdown: vi.fn(), markdownToHtml: vi.fn() },
    files: { list: vi.fn() },
    ui: { renderOutput: vi.fn(() => () => {}), el: vi.fn() },
    formatDate: vi.fn(),
    extensions: { get: vi.fn(async () => undefined) },
    ...overrides,
  } as unknown as MillPluginAPI
}

describe('callActivationMethod', () => {
  it('routes a reused simple door onto the plugin api', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await expect(callActivationMethod(ctx, api, 'kinds', [])).resolves.toEqual([])
    expect(api.kinds).toHaveBeenCalled()
  })

  it('routes context.set onto the plugin api (goal 0349 S2c)', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'context.set', ['hasResult', true])
    expect(api.context.set).toHaveBeenCalledWith('hasResult', true)
  })

  it('passes mixed scalar arrays and refusals through the same framed context door', async () => {
    const set = vi.fn((key: string, value: unknown) => setPluginContextKey('framed-probe', key, value))
    const api = fakeApi({ context: { set } })
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'context.set', ['values', ['ready', 0, false, null]])
    expect(pluginContextFacts('framed-probe')).toEqual({ 'plugin.values': ['ready', 0, false, null] })
    await expect(callActivationMethod(ctx, api, 'context.set', ['invalid', Infinity])).rejects.toThrow(/finite number/)
    teardownActivationFrameContext(ctx)
  })

  it('routes convert.markdownToHtml onto the plugin api, the activation bridge\'s one new door', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'convert.markdownToHtml', ['# Title'])
    expect(api.convert.markdownToHtml).toHaveBeenCalledWith('# Title')
  })

  it('refuses an unknown method, naming it', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await expect(callActivationMethod(ctx, api, 'registerCanvasObject', [])).rejects.toThrow('registerCanvasObject is not available in a frame')
  })

  it('register.command seats a command whose run() asks the frame and awaits its result', async () => {
    const api = fakeApi()
    const { frame, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'register.command', [{ id: 'go', label: 'Go' }])
    expect(api.registerCommand).toHaveBeenCalled()
    const decl = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0][0] as { run: () => Promise<void>; enabled: () => boolean }
    expect(decl.enabled()).toBe(true)

    const ran = decl.run()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'command.run', id: 'go' }), '*')
    const callId = (post.mock.calls[0][0] as { callId: number }).callId
    // The frame answers command.result, the reverse-call reply this
    // bridge itself listens for.
    const detach = attachActivationBridge({ ctx, api, onDone: () => {}, onError: () => {} })
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { mill: 1, kind: 'command.result', callId, ok: true } }))
    await expect(ran).resolves.toBeUndefined()
    detach()
  })

  it('enabled() goes false once the frame is torn down, and a pending run rejects', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'register.command', [{ id: 'go', label: 'Go' }])
    const decl = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0][0] as { run: () => Promise<void>; enabled: () => boolean }
    const pending = decl.run()
    teardownActivationFrameContext(ctx)
    expect(decl.enabled()).toBe(false)
    await expect(pending).rejects.toThrow('torn down')
  })

  // A declared item's `when` is the one honest predicate a framed
  // command can carry (goal 0349 S2c Decision 3): the manifest below
  // seats 'sendAgain' on view/title with when: "plugin.hasResult", so
  // enabled() answers false until the plugin's own context key (set
  // the same way api.context.set writes it, host-side) turns true.
  const WHEN_GATED_MANIFEST = {
    id: 'when-probe', name: 'When probe', version: '1.0.0', description: '', author: '', minMillVersion: '', icon: '', capabilities: [], dependencies: [], exports: [],
    contributes: {
      commands: [{ id: 'sendAgain', label: 'Send again', enablement: 'plugin.hasResult' }],
      menus: { 'view/title': [{ command: 'sendAgain', when: 'false', group: '' }] },
    },
  } as unknown as Manifest

  it("a framed command's enabled() honours command enablement independently of its menu's when clause", async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'when-probe', [], WHEN_GATED_MANIFEST)
    await callActivationMethod(ctx, api, 'register.command', [{ id: 'sendAgain', label: 'Send again' }])
    const decl = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0][0] as { enabled: () => boolean }
    expect(decl.enabled()).toBe(false)
    setPluginContextKey('when-probe', 'hasResult', true)
    expect(decl.enabled()).toBe(true)
  })

  it('teardown clears this plugin context and refuses a late context.set write', async () => {
    const api = fakeApi({ context: { set: (key, value) => setPluginContextKey('framed-probe', key, value) } })
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'context.set', ['ready', true])
    expect(pluginContextFacts('framed-probe')).toEqual({ 'plugin.ready': true })
    teardownActivationFrameContext(ctx)
    expect(pluginContextFacts('framed-probe')).toEqual({})
    await expect(callActivationMethod(ctx, api, 'context.set', ['ready', true])).rejects.toThrow('torn down')
    expect(pluginContextFacts('framed-probe')).toEqual({})
  })

  it('a framed command with no declared when clause stays always-enabled while alive', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'register.command', [{ id: 'go', label: 'Go' }])
    const decl = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0][0] as { enabled: () => boolean }
    expect(decl.enabled()).toBe(true)
  })

  it('register.view seats onMessage only when the frame declared one, and forwards a page message as an event', async () => {
    const api = fakeApi()
    const { frame, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'register.view', [{ id: 'panel', hasMessageHandler: true }])
    const decl = (api.registerView as ReturnType<typeof vi.fn>).mock.calls[0][0] as { id: string; onMessage?: (message: unknown) => void }
    expect(decl.id).toBe('panel')
    decl.onMessage?.({ hello: 1 })
    expect(post).toHaveBeenCalledWith({ mill: 1, kind: 'event', event: 'view.message', payload: { id: 'panel', payload: { hello: 1 } } }, '*')

    await callActivationMethod(ctx, api, 'register.view', [{ id: 'other', hasMessageHandler: false }])
    const withoutHandler = (api.registerView as ReturnType<typeof vi.fn>).mock.calls[1][0] as { onMessage?: unknown }
    expect(withoutHandler.onMessage).toBeUndefined()
  })

  it("view.postMessage reaches the view's own mounted frame through the same sink registerView's handle would", async () => {
    unregisterPluginViews('framed-probe')
    collectPluginView({ pluginId: 'framed-probe', pluginName: 'Framed probe', viewId: 'panel', title: 'Panel', version: '1.0.0', entry: 'panel.html' })
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const sink = vi.fn()
    setPluginViewSink('framed-probe', 'panel', sink)
    await callActivationMethod(ctx, api, 'view.postMessage', [{ id: 'panel', payload: { hello: 2 } }])
    expect(sink).toHaveBeenCalledWith({ hello: 2 })
    expect(getPluginView('framed-probe', 'panel')).toBeDefined()
  })

  it('register.capture seats onMessage only when declared, and capture.postMessage reaches the mounted capture', async () => {
    unregisterPluginCaptures('framed-probe')
    collectPluginCapture({ pluginId: 'framed-probe', pluginName: 'Framed probe', captureId: 'jot', label: 'Jot', version: '1.0.0', entry: 'jot.html' })
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'register.capture', [{ id: 'jot', hasMessageHandler: false }])
    expect(api.registerCapture).toHaveBeenCalledWith(expect.objectContaining({ id: 'jot', onMessage: undefined }))
    const sink = vi.fn()
    setPluginCaptureSink('framed-probe', 'jot', sink)
    await callActivationMethod(ctx, api, 'capture.postMessage', [{ id: 'jot', payload: 'x' }])
    expect(sink).toHaveBeenCalledWith('x')
    expect(getPluginCapture('framed-probe', 'jot')).toBeDefined()
  })

  it('subscribe/unsubscribe on contents:changed round-trips a subId', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const result = await callActivationMethod(ctx, api, 'subscribe', [{ topic: 'contents:changed' }])
    expect(result).toEqual({ subId: 1 })
    expect(ctx.subscriptions.has(1)).toBe(true)
    await callActivationMethod(ctx, api, 'unsubscribe', [{ subId: 1 }])
    expect(ctx.subscriptions.has(1)).toBe(false)
  })

  it('subscribe on an undeclared settings key still hands back a subId, quietly firing nothing', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const result = await callActivationMethod(ctx, api, 'subscribe', [{ topic: 'settings', key: 'missing' }])
    expect(result).toEqual({ subId: 1 })
  })

  // dispatchLifecycleEvent simulates the backend's own mill-lifecycle-event
  // emission (docs/goals/0392 S2) through @wailsio/runtime's real test hook
  // -- the same window._wails.dispatchWailsEvent path the generated
  // runtime itself calls on a real backend Emit, so this proves the whole
  // wire round-trip, not just this module's own filtering logic.
  function dispatchLifecycleEvent(data: Record<string, unknown>): void {
    const wails = (window as unknown as { _wails: { dispatchWailsEvent: (e: { name: string; data: unknown }) => void } })._wails
    wails.dispatchWailsEvent({ name: 'mill-lifecycle-event', data })
  }

  it('subscribe on entity.* forwards a matching lifecycle firing as a lifecycle.event message', async () => {
    const api = fakeApi()
    const { frame, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const { subId } = await callActivationMethod(ctx, api, 'subscribe', [{ topic: 'entity.*' }]) as { subId: number }

    dispatchLifecycleEvent({ event: 'entity.dereferenced', entityKind: 'list', entityId: 'list-1', remaining: 0 })

    expect(post).toHaveBeenCalledWith({
      mill: 1, kind: 'event', event: 'lifecycle.event',
      payload: { subId, event: 'entity.dereferenced', entityKind: 'list', entityId: 'list-1', remaining: 0 },
    }, '*')
  })

  it('subscribe on object.* ignores an entity.* firing, and kinds narrows within the family', async () => {
    const api = fakeApi()
    const { frame, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await callActivationMethod(ctx, api, 'subscribe', [{ topic: 'object.*', kinds: ['table'] }])

    dispatchLifecycleEvent({ event: 'entity.created', entityKind: 'list', entityId: 'list-1' })
    expect(post).not.toHaveBeenCalled()

    dispatchLifecycleEvent({ event: 'object.created', boardId: 'b1', objectId: 'o1', kind: 'image' })
    expect(post).not.toHaveBeenCalled()

    dispatchLifecycleEvent({ event: 'object.created', boardId: 'b1', objectId: 'o2', kind: 'table', entityRef: 'list' })
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      event: 'lifecycle.event', payload: expect.objectContaining({ event: 'object.created', kind: 'table' }),
    }), '*')
  })

  it('unsubscribe on entity.*/object.* stops further delivery', async () => {
    const api = fakeApi()
    const { frame, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const { subId } = await callActivationMethod(ctx, api, 'subscribe', [{ topic: 'entity.*' }]) as { subId: number }
    await callActivationMethod(ctx, api, 'unsubscribe', [{ subId }])

    dispatchLifecycleEvent({ event: 'entity.created', entityKind: 'list', entityId: 'list-1' })
    expect(post).not.toHaveBeenCalled()
  })

  it('extensions.get/extensions.call (goal 0364) route onto api.extensions', async () => {
    const get = vi.fn(async (id: string) => (id === 'mill-interop-provider' ? { greet: () => 'hi' } : undefined))
    const api = fakeApi({ extensions: { get } })
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    await expect(callActivationMethod(ctx, api, 'extensions.get', ['mill-interop-provider'])).resolves.toEqual({ data: {}, methods: ['greet'] })
    expect(get).toHaveBeenCalledWith('mill-interop-provider')
    await expect(callActivationMethod(ctx, api, 'extensions.call', ['mill-other', 'greet', []])).rejects.toThrow('Method greet is not exported by mill-other.')
  })
})

describe('sendExtensionCall (goal 0364)', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('resolves once the frame answers extension.result', async () => {
    const { frame, contentWindow, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const api = fakeApi()
    const detach = attachActivationBridge({ ctx, api, onDone: () => {}, onError: () => {} })
    const ran = sendExtensionCall(ctx, 'greet', ['Ada'])
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'extension.call', method: 'greet', args: ['Ada'] }), '*')
    const callId = (post.mock.calls[0][0] as { callId: number }).callId
    window.dispatchEvent(new MessageEvent('message', { source: contentWindow, data: { mill: 1, kind: 'extension.result', callId, ok: true, result: 'Hello, Ada' } }))
    await expect(ran).resolves.toBe('Hello, Ada')
    detach()
  })

  it('rejects with the frame-not-running sentence 10 s after no reply arrives', async () => {
    vi.useFakeTimers()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const ran = sendExtensionCall(ctx, 'greet', [])
    const assertion = expect(ran).rejects.toThrow('Extension framed-probe is not running.')
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })

  it('a torn-down frame rejects every pending extension call', async () => {
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const ran = sendExtensionCall(ctx, 'greet', [])
    teardownActivationFrameContext(ctx)
    await expect(ran).rejects.toThrow('Extension framed-probe is not running.')
  })
})

describe('attachActivationBridge', () => {
  afterEach(() => vi.restoreAllMocks())

  it('ignores a message whose source is not the frame it is bridging', async () => {
    const api = fakeApi()
    const { frame, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const onDone = vi.fn()
    const detach = attachActivationBridge({ ctx, api, onDone, onError: vi.fn() })
    window.dispatchEvent(new MessageEvent('message', { source: {} as Window, data: { mill: 1, kind: 'activation-done' } }))
    await Promise.resolve()
    expect(onDone).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    detach()
  })

  it('answers a call from its own frame with the routed result', async () => {
    const api = fakeApi()
    const { frame, contentWindow, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const detach = attachActivationBridge({ ctx, api, onDone: vi.fn(), onError: vi.fn() })
    window.dispatchEvent(new MessageEvent('message', { source: contentWindow, data: { mill: 1, id: 9, kind: 'call', method: 'kinds', args: [] } }))
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith({ mill: 1, id: 9, ok: true, result: [] }, '*'))
    detach()
  })

  it('signals activation-done and activation-error to the orchestrator', () => {
    const api = fakeApi()
    const { frame, contentWindow } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [], PROBE_MANIFEST)
    const onDone = vi.fn()
    const onError = vi.fn()
    const detach = attachActivationBridge({ ctx, api, onDone, onError })
    window.dispatchEvent(new MessageEvent('message', { source: contentWindow, data: { mill: 1, kind: 'activation-done' } }))
    expect(onDone).toHaveBeenCalled()
    window.dispatchEvent(new MessageEvent('message', { source: contentWindow, data: { mill: 1, kind: 'activation-error', error: 'broke' } }))
    expect(onError).toHaveBeenCalledWith('broke')
    detach()
  })
})
