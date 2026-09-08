// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachActivationBridge, callActivationMethod, createActivationFrameContext, sendExtensionCall, teardownActivationFrameContext } from './pluginActivationBridge'
import { collectPluginCapture, getPluginCapture, setPluginCaptureSink, unregisterPluginCaptures } from '../plugins/pluginCaptures'
import { collectPluginView, getPluginView, setPluginViewSink, unregisterPluginViews } from '../plugins/pluginViews'
import type { MillPluginAPI } from '../plugins/sdk'

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
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
    await expect(callActivationMethod(ctx, api, 'kinds', [])).resolves.toEqual([])
    expect(api.kinds).toHaveBeenCalled()
  })

  it('routes convert.markdownToHtml onto the plugin api, the activation bridge\'s one new door', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
    await callActivationMethod(ctx, api, 'convert.markdownToHtml', ['# Title'])
    expect(api.convert.markdownToHtml).toHaveBeenCalledWith('# Title')
  })

  it('refuses an unknown method, naming it', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
    await expect(callActivationMethod(ctx, api, 'registerCanvasObject', [])).rejects.toThrow('registerCanvasObject is not available in a frame')
  })

  it('register.command seats a command whose run() asks the frame and awaits its result', async () => {
    const api = fakeApi()
    const { frame, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
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
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
    await callActivationMethod(ctx, api, 'register.command', [{ id: 'go', label: 'Go' }])
    const decl = (api.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0][0] as { run: () => Promise<void>; enabled: () => boolean }
    const pending = decl.run()
    teardownActivationFrameContext(ctx)
    expect(decl.enabled()).toBe(false)
    await expect(pending).rejects.toThrow('torn down')
  })

  it('register.view seats onMessage only when the frame declared one, and forwards a page message as an event', async () => {
    const api = fakeApi()
    const { frame, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
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
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
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
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
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
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
    const result = await callActivationMethod(ctx, api, 'subscribe', [{ topic: 'contents:changed' }])
    expect(result).toEqual({ subId: 1 })
    expect(ctx.subscriptions.has(1)).toBe(true)
    await callActivationMethod(ctx, api, 'unsubscribe', [{ subId: 1 }])
    expect(ctx.subscriptions.has(1)).toBe(false)
  })

  it('subscribe on an undeclared settings key still hands back a subId, quietly firing nothing', async () => {
    const api = fakeApi()
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
    const result = await callActivationMethod(ctx, api, 'subscribe', [{ topic: 'settings', key: 'missing' }])
    expect(result).toEqual({ subId: 1 })
  })

  it('extensions.get/extensions.call (goal 0364) route onto api.extensions', async () => {
    const get = vi.fn(async (id: string) => (id === 'mill-interop-provider' ? { greet: () => 'hi' } : undefined))
    const api = fakeApi({ extensions: { get } })
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
    await expect(callActivationMethod(ctx, api, 'extensions.get', ['mill-interop-provider'])).resolves.toEqual({ data: {}, methods: ['greet'] })
    expect(get).toHaveBeenCalledWith('mill-interop-provider')
    await expect(callActivationMethod(ctx, api, 'extensions.call', ['mill-other', 'greet', []])).rejects.toThrow('Method greet is not exported by mill-other.')
  })
})

describe('sendExtensionCall (goal 0364)', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('resolves once the frame answers extension.result', async () => {
    const { frame, contentWindow, post } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
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
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
    const ran = sendExtensionCall(ctx, 'greet', [])
    const assertion = expect(ran).rejects.toThrow('Extension framed-probe is not running.')
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
  })

  it('a torn-down frame rejects every pending extension call', async () => {
    const { frame } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
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
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
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
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
    const detach = attachActivationBridge({ ctx, api, onDone: vi.fn(), onError: vi.fn() })
    window.dispatchEvent(new MessageEvent('message', { source: contentWindow, data: { mill: 1, id: 9, kind: 'call', method: 'kinds', args: [] } }))
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith({ mill: 1, id: 9, ok: true, result: [] }, '*'))
    detach()
  })

  it('signals activation-done and activation-error to the orchestrator', () => {
    const api = fakeApi()
    const { frame, contentWindow } = fakeFrame()
    const ctx = createActivationFrameContext(frame, 'framed-probe', [])
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
