import { describe, expect, it, vi } from 'vitest'
import { callFrameMethod, FRAME_METHODS, handleFrameMessage } from './pluginFrameBridge'
import type { MillPluginAPI } from '../plugins/sdk'

// The bridge is the only surface a framed page can reach Mill through,
// so what it refuses matters as much as what it routes: a method off
// the whitelist, and a message from any window but the frame's own.

function fakeApi(overrides: Partial<MillPluginAPI> = {}): MillPluginAPI {
  const store = new Map<string, unknown>()
  return {
    millVersion: '1.0.0',
    pluginId: 'probe',
    registerCanvasObject: vi.fn(),
    registerCommand: vi.fn(),
    registerView: vi.fn(),
    registerCapture: vi.fn(),
    requestGuardedAction: vi.fn(),
    settings: { get: vi.fn(() => 'value'), onChange: vi.fn() },
    notify: vi.fn(() => () => {}),
    storage: {
      get: (key: string) => store.get(key),
      set: async (key: string, value: unknown) => { store.set(key, value) },
      delete: async (key: string) => { store.delete(key) },
      keys: () => [...store.keys()],
    },
    query: vi.fn(async () => []),
    on: vi.fn(() => () => {}),
    fetch: vi.fn(),
    content: { createNote: vi.fn(), createCard: vi.fn(), updateCard: vi.fn(), appendListRow: vi.fn(), createList: vi.fn() },
    convert: { htmlToMarkdown: vi.fn() },
    files: { list: vi.fn() },
    ui: { renderOutput: vi.fn(() => () => {}) },
    ...overrides,
  } as unknown as MillPluginAPI
}

describe('callFrameMethod', () => {
  it('refuses a method that is not on the whitelist, naming it', async () => {
    await expect(callFrameMethod(fakeApi(), 'ui.renderOutput', [])).rejects.toThrow('ui.renderOutput is not available in a frame')
    await expect(callFrameMethod(fakeApi(), 'registerCommand', [])).rejects.toThrow('not available in a frame')
  })

  it('routes a whitelisted call onto the plugin api', async () => {
    const api = fakeApi()
    await expect(callFrameMethod(api, 'settings.get', ['mode'])).resolves.toBe('value')
    expect(api.settings.get).toHaveBeenCalledWith('mode')
  })

  it('answers true for notify, whose own return value is a function', async () => {
    const api = fakeApi()
    await expect(callFrameMethod(api, 'notify', [{ text: 'listed' }])).resolves.toBe(true)
    expect(api.notify).toHaveBeenCalledWith({ text: 'listed' })
  })

  it('round-trips a value through the plugin storage door', async () => {
    const api = fakeApi()
    await callFrameMethod(api, 'storage.set', ['view:panel:state', { grouped: false }])
    await expect(callFrameMethod(api, 'storage.get', ['view:panel:state'])).resolves.toEqual({ grouped: false })
  })

  it('closes the capture window only through the controls the host supplied', async () => {
    const done = vi.fn()
    const cancel = vi.fn()
    await callFrameMethod(fakeApi(), 'capture.done', [], { done, cancel })
    expect(done).toHaveBeenCalled()
    // With no capture controls (a view's frame) the call is a no-op
    // rather than a crash.
    await expect(callFrameMethod(fakeApi(), 'capture.cancel', [])).resolves.toBe(true)
    expect(cancel).not.toHaveBeenCalled()
  })

  it("routes a face's object doors only through the controls the host supplied", async () => {
    await expect(callFrameMethod(fakeApi(), 'object.updatePayload', [{ text: 'x' }])).rejects.toThrow("object.updatePayload is only available in a canvas object's face")
    const updatePayload = vi.fn(async () => {})
    const setEditing = vi.fn()
    await expect(callFrameMethod(fakeApi(), 'object.updatePayload', [{ text: 'x' }], undefined, { updatePayload, setEditing })).resolves.toBe(true)
    expect(updatePayload).toHaveBeenCalledWith({ text: 'x' })
    await expect(callFrameMethod(fakeApi(), 'object.setEditing', [true], undefined, { updatePayload, setEditing })).resolves.toBe(true)
    expect(setEditing).toHaveBeenCalledWith(true)
  })
  it('keeps every whitelisted name routable', async () => {
    const api = fakeApi()
    for (const method of FRAME_METHODS) {
      await expect(callFrameMethod(api, method, ['a', {}, 'c'], { done: () => {}, cancel: () => {} }, { updatePayload: async () => {}, setEditing: () => {} })).resolves.not.toThrow()
    }
  })
})

describe('handleFrameMessage', () => {
  const fakeFrame = () => {
    const post = vi.fn()
    const contentWindow = { postMessage: post } as unknown as Window
    return { post, contentWindow, frame: { contentWindow } as unknown as HTMLIFrameElement }
  }

  it('ignores a message whose source is not the frame it is bridging', async () => {
    const api = fakeApi()
    const { frame, post } = fakeFrame()
    const other = {} as Window
    handleFrameMessage({ frame, api }, { source: other, data: { mill: 1, id: 1, kind: 'call', method: 'settings.get', args: ['mode'] } })
    await Promise.resolve()
    expect(api.settings.get).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('ignores a message that does not carry the frame envelope', async () => {
    const api = fakeApi()
    const { frame, contentWindow, post } = fakeFrame()
    handleFrameMessage({ frame, api }, { source: contentWindow, data: { id: 1, kind: 'call', method: 'settings.get' } })
    await Promise.resolve()
    expect(post).not.toHaveBeenCalled()
  })

  it('answers a call from its own frame with the result', async () => {
    const api = fakeApi()
    const { frame, contentWindow, post } = fakeFrame()
    handleFrameMessage({ frame, api }, { source: contentWindow, data: { mill: 1, id: 7, kind: 'call', method: 'settings.get', args: ['mode'] } })
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith({ mill: 1, id: 7, ok: true, result: 'value' }, '*'))
  })

  it('reports a refused method back to the page as an error reply', async () => {
    const { frame, contentWindow, post } = fakeFrame()
    handleFrameMessage({ frame, api: fakeApi() }, { source: contentWindow, data: { mill: 1, id: 3, kind: 'call', method: 'registerCommand', args: [] } })
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith({ mill: 1, id: 3, ok: false, error: 'registerCommand is not available in a frame' }, '*'))
  })

  it("hands the page's own message, state and ready signal to the host callbacks", () => {
    const { frame, contentWindow } = fakeFrame()
    const onPageMessage = vi.fn()
    const onState = vi.fn()
    const onReady = vi.fn()
    const options = { frame, api: fakeApi(), onPageMessage, onState, onReady }
    handleFrameMessage(options, { source: contentWindow, data: { mill: 1, kind: 'message', payload: { hello: 1 } } })
    handleFrameMessage(options, { source: contentWindow, data: { mill: 1, kind: 'state', payload: 'grouped' } })
    handleFrameMessage(options, { source: contentWindow, data: { mill: 1, kind: 'ready' } })
    expect(onPageMessage).toHaveBeenCalledWith({ hello: 1 })
    expect(onState).toHaveBeenCalledWith('grouped')
    expect(onReady).toHaveBeenCalled()
  })
})
