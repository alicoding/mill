import { formatPluginDate } from '../plugins/pluginDateFormat'
import type { FrameEvent, FrameReply } from '../app/pluginFrameBridge'
import type { FrameInit } from '../app/pluginFrameBootstrap'
import type { MillFrameApi, MillFrameEvent } from '../plugins/sdk'
import type { KeyCombo } from '../shared/keybinding'
import { paletteShortcutForEvent } from './paletteShortcut'

// window.acquireMillApi/acquireVsCodeApi (goal 0349, goal 0396): this
// file is the only place either is ever ASSIGNED, but a page it is
// injected into (an entry page's own script, e2e helpers) reads them
// as ambient globals -- declared here once so every such reader gets
// the real MillFrameApi shape instead of `any`.
declare global {
	interface Window {
		acquireMillApi?: () => MillFrameApi
		acquireVsCodeApi?: () => Pick<MillFrameApi, 'postMessage' | 'getState' | 'setState'>
	}
}

// The door a plugin's entry page holds: window.acquireMillApi(), and
// window.acquireVsCodeApi() in the editor-webview shape (goal 0349).
// Mill injects a <script src> for this file into every framed view and
// capture, a separate file rather than inline script because the
// document's Content-Security-Policy forbids inline script outright
// (docs/platform/PLUGIN-THREAT-MODEL.md, T9) and a framed page inherits
// that policy from the document embedding it.
//
// It runs on an OPAQUE origin: the frame is sandboxed without
// allow-same-origin, so nothing here can reach Mill's document,
// cookies or storage, and postMessage to the parent is the only
// channel that exists. Its mount data arrives on a <meta> element for
// the same inline-script reason.
//
// Built from this TypeScript source into a self-contained IIFE
// (frontend/vite.config.frame.ts, goal 0396) -- formatDate is the SAME
// pure helper hostApi.ts's own same-DOM formatDate and this frame's
// activation.ts sibling both use, imported rather than hand-copied.

interface BootstrapFrameInit extends FrameInit {
	theme: FrameInit['theme']
}

;(function () {
	const initMeta = document.querySelector('meta[name="mill-frame-init"]')
	let init: BootstrapFrameInit = { theme: { mode: 'light', scheme: 'light' }, state: undefined, context: {}, paletteBindings: [] }
	try {
		if (initMeta) init = JSON.parse(initMeta.getAttribute('content') || '{}') as BootstrapFrameInit
	} catch (err) {
		console.error('the frame could not read its own mount data', err)
	}

	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
	const messageHandlers: ((payload: unknown) => void)[] = []
	const eventHandlers = new Map<string, ((payload: unknown) => void)[]>()
	let seq = 0
	let theme = init.theme || { mode: 'light', scheme: 'light' }
	let context: Record<string, unknown> = init.context || {}
	let paletteBindings: KeyCombo[] = init.paletteBindings || []
	let state: unknown = init.state
	let vsCodeAcquired = false

	function applyTheme(next: FrameInit['theme'], tokens?: string): void {
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

	function send(msg: Record<string, unknown>): void {
		msg.mill = 1
		window.parent.postMessage(msg, '*')
	}

	function subscribe(list: ((payload: unknown) => void)[], fn: (payload: unknown) => void): () => void {
		list.push(fn)
		return () => {
			const at = list.indexOf(fn)
			if (at >= 0) list.splice(at, 1)
		}
	}

	function onHostEvent(data: FrameEvent): void {
		if (data.event === 'theme:changed') applyTheme(data.payload as FrameInit['theme'], data.tokens)
		if (data.event === 'ctx') context = data.payload as Record<string, unknown>
		if (data.event === 'palette-bindings') paletteBindings = Array.isArray(data.payload) ? data.payload as KeyCombo[] : []
		const handlers = (eventHandlers.get(data.event) || []).slice()
		for (const handler of handlers) handler(data.payload)
	}

	function onReply(data: FrameReply): void {
		const waiting = pending.get(data.id)
		if (!waiting) return
		pending.delete(data.id)
		if (data.ok) waiting.resolve(data.result)
		else waiting.reject(new Error(data.error || 'the call failed'))
	}

	window.addEventListener('message', (event) => {
		if (event.source !== window.parent) return
		const data = event.data as { mill?: number; kind?: string; id?: number; [key: string]: unknown } | null
		if (!data || data.mill !== 1) return
		if (data.kind === 'event') onHostEvent(data as unknown as FrameEvent)
		else if (data.kind === 'message') {
			const handlers = messageHandlers.slice()
			for (const handler of handlers) handler(data.payload)
		} else if (data.id !== undefined) onReply(data as unknown as FrameReply)
	})

	window.addEventListener('keydown', (event) => {
		const combo = paletteShortcutForEvent(event, paletteBindings)
		if (!combo) return
		event.preventDefault()
		send({ kind: 'palette-shortcut', payload: combo })
	})

	function postMessage(message: unknown): void { send({ kind: 'message', payload: message }) }
	function getState(): unknown { return state }
	function setState(next: unknown): unknown {
		state = next
		send({ kind: 'state', payload: next })
		return next
	}

	const api: MillFrameApi = {
		postMessage,
		getState,
		setState,
		onMessage: (fn: (payload: unknown) => void) => subscribe(messageHandlers, fn),
		call: (method: string, ...args: unknown[]) => new Promise<unknown>((resolve, reject) => {
			const id = ++seq
			pending.set(id, { resolve, reject })
			send({ id, kind: 'call', method, args })
		}),
		on: (event: MillFrameEvent, fn: (payload: unknown) => void) => {
			const list = eventHandlers.get(event) || []
			eventHandlers.set(event, list)
			return subscribe(list, fn)
		},
		// formatDate (goal 0386 S1) mirrors hostApi.ts's own formatPluginDate
		// and the activation frame's own copy -- one shared module (goal
		// 0396). Needs no call(): it touches nothing outside its own input.
		formatDate: formatPluginDate,
		get theme() { return theme },
		get context() { return context },
	}
	Object.freeze(api)

	applyTheme(theme)
	window.acquireMillApi = () => api
	// The webview shape a widely-used editor's extension pages already
	// speak, verbatim, so such a page drops in unchanged: three methods,
	// and acquiring it twice throws.
	window.acquireVsCodeApi = () => {
		if (vsCodeAcquired) throw new Error('An instance of the VS Code API has already been acquired')
		vsCodeAcquired = true
		return Object.freeze({ postMessage, getState, setState })
	}
	send({ kind: 'ready' })
})()
