import type { ActivationFrameInit } from '../app/pluginFrameBootstrap'
import { buildFetchJSON } from '../plugins/pluginFetchJSON'
import { formatPluginDate } from '../plugins/pluginDateFormat'
import { buildPluginStorage, type PluginStorageDoors } from '../plugins/pluginStorage'
import type { ContentQuery, LifecycleEventPayload, LinkQuery, MillPluginAPI, PluginCaptureDecl, PluginCaptureHandle, PluginCommandDecl, PluginContextValue, PluginFetchResult, PluginNoticeInput, PluginViewDecl, PluginViewHandle } from '../plugins/sdk'
import { CANVAS_TOOL_CALLS, buildCanvasToolsFrameHalf, registerManifestCanvasFaces } from './canvasTools'

// A third-party plugin's own activation, run inside a hidden sandboxed
// frame (goal 0375 S1b): main.js's activate(api) runs HERE, not in
// Mill's own document, closing the same-DOM guardrail bypass every
// other framed surface already closed. Distinct from bootstrap.ts --
// there is no plugin-authored page in this document, so this script
// builds the full FramedPluginAPI shape a same-DOM plugin holds, over
// messages, and imports main.js itself once that door exists.
//
// It runs on an OPAQUE origin (sandbox, no allow-same-origin): nothing
// here can reach Mill's document, cookies or storage, and postMessage
// to the parent is the only channel that exists.
//
// Built from this TypeScript source into a self-contained IIFE
// (frontend/vite.config.frame.ts, goal 0396) -- never imported live:
// the emitted bundle carries no import/export statement, so it needs
// no bundler wherever it is served. Every pure helper it uses
// (buildFetchJSON, buildPluginStorage, formatPluginDate) is the SAME
// module hostApi.ts's same-DOM activation imports -- one
// implementation, not a hand-kept copy.

// FramedPluginAPI is everything this frame's own api object
// implements: MillPluginAPI minus the two doors a framed activation
// has no story for yet (evaluateGuardedAction, callIntegration --
// neither door existed when this frame runtime was first built).
// A plugin calling one of the two gets "is not a function", the same
// answer any object missing a property gives -- unchanged from before
// this file existed.
type FramedPluginAPI = Omit<MillPluginAPI, 'evaluateGuardedAction' | 'callIntegration'>

// ACTIVATION_CALL_METHODS -- every RPC method name this file's own
// call() invokes, kept in one place so the Vitest protocol-surface
// test (plugin-frame/protocol.test.ts) can assert it against the
// host's own SIMPLE_DOORS + ACTIVATION_ONLY_METHODS
// (pluginActivationBridge.ts): one source of truth for both sides
// instead of the byte-parity test this file replaces.
export const ACTIVATION_CALL_METHODS = [
	'notify', 'storage.set', 'storage.delete', 'query', 'kinds', 'links', 'linkKinds', 'open', 'fetch',
	'content.createNote', 'content.createCard', 'content.updateCard', 'content.appendListRow', 'content.createList', 'content.setCardFields',
	'files.list', 'convert.htmlToMarkdown', 'convert.markdownToHtml', 'requestGuardedAction', 'context.set',
	'register.command', 'register.view', 'register.capture',
	'view.postMessage', 'capture.postMessage',
	'subscribe', 'unsubscribe',
	'extensions.get', 'extensions.call',
	...CANVAS_TOOL_CALLS,
] as const

;(function () {
	const initMeta = document.querySelector('meta[name="mill-frame-init"]')
	let init: ActivationFrameInit = { pluginId: '', millVersion: '', version: '', settings: {}, storage: {}, exports: [], capabilities: [], canvasFaces: [] }
	try {
		if (initMeta) init = JSON.parse(initMeta.getAttribute('content') || '{}') as ActivationFrameInit
	} catch (err) {
		console.error('the activation frame could not read its own mount data', err)
	}

	const pluginId = init.pluginId
	const settingsSnapshot: Record<string, boolean | string | number> = { ...init.settings }
	// exportAllowlist/exportedObject are extension interop's own state
	// (goal 0364): the manifest's own exports allowlist, and what
	// activate() actually returned -- kept so a LATER 'extension.call'
	// from the host (another extension calling one of THIS plugin's
	// own exported methods) has something to invoke.
	const exportAllowlist = init.exports || []
	let exportedObject: Record<string, unknown> | undefined

	const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>() // call id -> this frame's own outbound calls
	let seq = 0
	const runHandlers = new Map<string, () => void>() // command id -> run()
	const viewMessageHandlers = new Map<string, (message: unknown) => void>()
	const captureMessageHandlers = new Map<string, (message: unknown) => void>()
	const settingsHandlers = new Map<number, { key: string; fn: (value: boolean | string | number) => void }>()
	const contentsHandlers = new Map<number, { kinds?: string[]; fn: (payload: { id: string; kind?: string }) => void }>()
	const lifecycleHandlers = new Map<number, (payload: LifecycleEventPayload) => void>() // subId -> fn (goal 0392 S2, entity.*/object.*)

	function send(msg: Record<string, unknown>): void {
		msg.mill = 1
		window.parent.postMessage(msg, '*')
	}

	// call is this frame's half of the same request/reply shape every
	// framed page's window.acquireMillApi().call() uses
	// (pluginFrameBridge.ts answers it identically): a door not on the
	// host's activation method table rejects, naming itself.
	function call(method: string, ...args: unknown[]): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = ++seq
			pending.set(id, { resolve, reject })
			send({ id, kind: 'call', method, args })
		})
	}

	function onReply(data: { id: number; ok: boolean; result?: unknown; error?: string }): void {
		const waiting = pending.get(data.id)
		if (!waiting) return
		pending.delete(data.id)
		if (data.ok) waiting.resolve(data.result)
		else waiting.reject(new Error(data.error || 'the call failed'))
	}

	// onCommandRun answers the host's own reverse call: it asked one of
	// THIS plugin's registered commands to run, and waits for the exact
	// result runCommand() sees anywhere else.
	function onCommandRun(data: { id: string; callId: number }): void {
		const run = runHandlers.get(data.id)
		if (!run) { send({ kind: 'command.result', callId: data.callId, ok: false, error: `command "${data.id}" is not registered` }); return }
		Promise.resolve()
			.then(() => run())
			.then(() => send({ kind: 'command.result', callId: data.callId, ok: true }))
			.catch((err: unknown) => send({ kind: 'command.result', callId: data.callId, ok: false, error: err instanceof Error ? err.message : String(err) }))
	}

	// onExtensionCall answers the host's own reverse call (goal 0364):
	// another extension is calling one of THIS plugin's own exported
	// methods. Re-checks the allowlist here too, never trusting that
	// the host's own gate was the only one -- a method the manifest
	// never listed, or a name not actually a function on the object
	// activate() returned, both refuse the same way.
	function onExtensionCall(data: { method: string; callId: number; args?: unknown[] }): void {
		const fn = exportedObject && typeof exportedObject === 'object' ? exportedObject[data.method] : undefined
		if (exportAllowlist.indexOf(data.method) === -1 || typeof fn !== 'function') {
			send({ kind: 'extension.result', callId: data.callId, ok: false, error: `Method ${data.method} is not exported by ${pluginId}.` })
			return
		}
		Promise.resolve()
			.then(() => (fn as (...args: unknown[]) => unknown).apply(exportedObject, data.args || []))
			.then((result) => send({ kind: 'extension.result', callId: data.callId, ok: true, result }))
			.catch((err: unknown) => send({ kind: 'extension.result', callId: data.callId, ok: false, error: err instanceof Error ? err.message : String(err) }))
	}

	function onViewOrCaptureMessage(handlers: Map<string, (message: unknown) => void>, payload: Record<string, unknown>): void {
		const h = handlers.get(String(payload.id))
		if (h) h(payload.payload)
	}

	function onSettingsChanged(payload: Record<string, unknown>): void {
		const sh = settingsHandlers.get(Number(payload.subId))
		if (!sh) return
		const value = payload.value as boolean | string | number
		settingsSnapshot[sh.key] = value
		sh.fn(value)
	}

	function onContentsChanged(payload: Record<string, unknown>): void {
		const ch = contentsHandlers.get(Number(payload.subId))
		const kind = payload.kind as string | undefined
		if (ch && (!ch.kinds || (kind !== undefined && ch.kinds.indexOf(kind) !== -1))) ch.fn({ id: String(payload.id ?? ''), kind })
	}

	function onLifecycleEvent(payload: Record<string, unknown>): void {
		const lh = lifecycleHandlers.get(Number(payload.subId))
		if (!lh) return
		const rest = { ...payload }
		delete rest.subId
		lh(rest as unknown as LifecycleEventPayload)
	}

	function onEvent(data: { event: string; payload: Record<string, unknown> }): void {
		switch (data.event) {
			case 'view.message': onViewOrCaptureMessage(viewMessageHandlers, data.payload); break
			case 'capture.message': onViewOrCaptureMessage(captureMessageHandlers, data.payload); break
			case 'settings.changed': onSettingsChanged(data.payload); break
			case 'contents.changed': onContentsChanged(data.payload); break
			case 'lifecycle.event': onLifecycleEvent(data.payload); break
			case 'tool.pointer': canvasTools.onToolPointer(data.payload); break
		}
	}

	window.addEventListener('message', (event) => {
		if (event.source !== window.parent) return
		const data = event.data as { mill?: number; kind?: string; id?: number; [key: string]: unknown } | null
		if (!data || data.mill !== 1) return
		if (data.kind === 'event') onEvent(data as unknown as { event: string; payload: Record<string, unknown> })
		else if (data.kind === 'command.run') onCommandRun(data as unknown as { id: string; callId: number })
		else if (data.kind === 'extension.call') onExtensionCall(data as unknown as { method: string; callId: number; args?: unknown[] })
		else if (data.id !== undefined) onReply(data as unknown as { id: number; ok: boolean; result?: unknown; error?: string })
	})

	function notAvailable(name: string): () => never {
		return () => { throw new Error(`plugin ${pluginId}: ${name} is not available for a framed extension; use an entry page`) }
	}

	// fetchJSON/storage/formatDate (goal 0386 S1) are the SAME pure
	// helpers hostApi.ts's own same-DOM activation uses -- buildFetchJSON
	// takes the fetch door itself (works identically over hostApi.ts's
	// real fetch and this frame's own call('fetch', ...)); buildPluginStorage
	// takes its persistence doors the same way, here answered over
	// call('storage.set'/'storage.delete', ...) instead of SettingsService
	// directly (this frame cannot reach generated bindings at all); init.storage
	// arrives already decoded (it crossed the mount-data JSON once already),
	// so it is re-encoded to the literal-string snapshot buildPluginStorage
	// expects -- the same shape loadPluginStorage() hands the host.
	const fetchDoor = (url: string, requestInit?: Parameters<MillPluginAPI['fetch']>[1]) => call('fetch', url, requestInit || {}) as Promise<PluginFetchResult>
	const fetchJSON = buildFetchJSON(fetchDoor)

	const storageLiterals: Record<string, string> = {}
	for (const [key, value] of Object.entries(init.storage)) storageLiterals[key] = JSON.stringify(value)
	const storageDoors: PluginStorageDoors = {
		set: (key, value) => call('storage.set', key, value).then(() => undefined),
		delete: (key) => call('storage.delete', key).then(() => undefined),
	}
	const storage = buildPluginStorage(pluginId, storageLiterals, storageDoors)
	const canvasTools = buildCanvasToolsFrameHalf(call, pluginId, init.capabilities || [])

	const api: FramedPluginAPI = {
		millVersion: init.millVersion,
		pluginId,
		settings: Object.freeze({
			get: (key: string) => settingsSnapshot[key],
			onChange: (key: string, fn: (value: boolean | string | number) => void) => {
				let subId = 0
				call('subscribe', { topic: 'settings', key }).then((r) => {
					subId = (r as { subId: number }).subId
					settingsHandlers.set(subId, { key, fn })
				}).catch((err: unknown) => console.error(`plugin ${pluginId}: settings.onChange failed`, err))
				return () => {
					settingsHandlers.delete(subId)
					void call('unsubscribe', { subId })
				}
			},
		}),
		// The context-key door (goal 0349 S2c): fire-and-forget, the same
		// shape notify/open already use -- a declared item's `when`
		// clause reads the new value the next time it is evaluated, so
		// this door needs no reply.
		context: Object.freeze({ set: (key: string, value: PluginContextValue) => { void call('context.set', key, value) } }),
		notify: (input: PluginNoticeInput) => { void call('notify', input); return () => {} },
		storage,
		query: (q?: ContentQuery) => call('query', q || {}) as ReturnType<MillPluginAPI['query']>,
		kinds: () => call('kinds') as ReturnType<MillPluginAPI['kinds']>,
		links: (q?: LinkQuery) => call('links', q || {}) as ReturnType<MillPluginAPI['links']>,
		linkKinds: () => call('linkKinds') as ReturnType<MillPluginAPI['linkKinds']>,
		open: (cardId: string) => { void call('open', cardId) },
		on: ((event: string, handler: (payload: unknown) => void, filter?: { kinds?: string[] }) => {
			if (event === 'contents:changed') {
				let subId = 0
				call('subscribe', { topic: 'contents:changed', kinds: filter?.kinds }).then((r) => {
					subId = (r as { subId: number }).subId
					contentsHandlers.set(subId, { kinds: filter?.kinds, fn: handler as (payload: { id: string; kind?: string }) => void })
				}).catch((err: unknown) => console.error(`plugin ${pluginId}: on("contents:changed") failed`, err))
				return () => {
					contentsHandlers.delete(subId)
					void call('unsubscribe', { subId })
				}
			}
			// entity.*/object.* (goal 0392 S2): the host already filters by
			// kinds before posting, so this side just registers the
			// handler under its own subId.
			if (event === 'entity.*' || event === 'object.*') {
				let lifecycleSubId = 0
				call('subscribe', { topic: event, kinds: filter?.kinds }).then((r) => {
					lifecycleSubId = (r as { subId: number }).subId
					lifecycleHandlers.set(lifecycleSubId, handler as (payload: LifecycleEventPayload) => void)
				}).catch((err: unknown) => console.error(`plugin ${pluginId}: on("${event}") failed`, err))
				return () => {
					lifecycleHandlers.delete(lifecycleSubId)
					void call('unsubscribe', { subId: lifecycleSubId })
				}
			}
			throw new Error(`plugin ${pluginId}: unknown event "${event}"`)
		}) as MillPluginAPI['on'],
		fetch: (url: string, requestInit?: Parameters<MillPluginAPI['fetch']>[1]) => call('fetch', url, requestInit || {}) as ReturnType<MillPluginAPI['fetch']>,
		fetchJSON,
		formatDate: formatPluginDate,
		content: Object.freeze({
			createNote: (input) => call('content.createNote', input) as ReturnType<MillPluginAPI['content']['createNote']>,
			createCard: (input) => call('content.createCard', input) as ReturnType<MillPluginAPI['content']['createCard']>,
			updateCard: (id, patch) => call('content.updateCard', id, patch) as ReturnType<MillPluginAPI['content']['updateCard']>,
			appendListRow: (listId, values) => call('content.appendListRow', listId, values) as ReturnType<MillPluginAPI['content']['appendListRow']>,
			createList: (input) => call('content.createList', input) as ReturnType<MillPluginAPI['content']['createList']>,
			setCardFields: (cardId, fields) => call('content.setCardFields', cardId, fields) as ReturnType<MillPluginAPI['content']['setCardFields']>,
		}),
		files: Object.freeze({
			list: (path: string) => call('files.list', path) as ReturnType<MillPluginAPI['files']['list']>,
			saveImageBytes: canvasTools.saveImageBytes,
		}),
		convert: Object.freeze({
			htmlToMarkdown: (html: string) => call('convert.htmlToMarkdown', html) as Promise<string>,
			markdownToHtml: (md: string) => call('convert.markdownToHtml', md) as Promise<string>,
		}),
		requestGuardedAction: (kind, attributes, description) => call('requestGuardedAction', kind, attributes, description) as ReturnType<MillPluginAPI['requestGuardedAction']>,
		// The same-DOM face/gesture form genuinely cannot work here (it
		// hands out host elements and live callbacks); registerCanvasTool
		// is the framed shape of the same contribution.
		registerCanvasObject: notAvailable('registerCanvasObject'),
		registerCanvasTool: canvasTools.registerCanvasTool,
		registerCanvasObjectFace: canvasTools.registerCanvasObjectFace,
		measure: canvasTools.measure,
		registerCommand: (decl: PluginCommandDecl) => {
			runHandlers.set(decl.id, decl.run)
			void call('register.command', { id: decl.id, label: decl.label }).catch((err: unknown) => console.error(`plugin ${pluginId}: registerCommand failed`, err))
		},
		registerView: (decl: PluginViewDecl): PluginViewHandle => {
			if (decl.onMessage) viewMessageHandlers.set(decl.id, decl.onMessage)
			void call('register.view', { id: decl.id, hasMessageHandler: !!decl.onMessage }).catch((err: unknown) => console.error(`plugin ${pluginId}: registerView failed`, err))
			return { postMessage: (message: unknown) => { void call('view.postMessage', { id: decl.id, payload: message }) } }
		},
		registerCapture: (decl: PluginCaptureDecl): PluginCaptureHandle => {
			if (decl.onMessage) captureMessageHandlers.set(decl.id, decl.onMessage)
			void call('register.capture', { id: decl.id, hasMessageHandler: !!decl.onMessage }).catch((err: unknown) => console.error(`plugin ${pluginId}: registerCapture failed`, err))
			return { postMessage: (message: unknown) => { void call('capture.postMessage', { id: decl.id, payload: message }) } }
		},
		// el has nowhere to mount into here: a framed activation's own
		// document is never attached anywhere Mill's UI can reach, unlike
		// a canvas object's own face element.
		ui: Object.freeze({ renderOutput: notAvailable('ui.renderOutput'), el: notAvailable('ui.el') }),
		// The extension-interop door (goal 0364): the host answers
		// {data, methods} (a live function cannot cross postMessage),
		// wrapped here into callable stubs that call 'extensions.call'
		// for each method name -- the same shape a same-DOM caller's
		// api.extensions.get gets directly.
		extensions: Object.freeze({
			get: (id: string) => call('extensions.get', id).then((descriptor) => {
				if (!descriptor) return undefined
				const view: Record<string, unknown> = {}
				const d = descriptor as { data?: Record<string, unknown>; methods?: string[] }
				const data = d.data || {}
				for (const key of Object.keys(data)) view[key] = data[key]
				const methods = d.methods || []
				methods.forEach((m) => {
					view[m] = (...callArgs: unknown[]) => call('extensions.call', id, m, callArgs)
				})
				return view
			}),
		}),
	}

	// resolveActivate mirrors loader.ts's own function of the same name:
	// a module exports activate() directly, as its default, or as
	// default.activate.
	function resolveActivate(mod: Record<string, unknown>): ((api: FramedPluginAPI) => unknown) | null {
		if (typeof mod.activate === 'function') return mod.activate as (api: FramedPluginAPI) => unknown
		if (typeof mod.default === 'function') return mod.default as (api: FramedPluginAPI) => unknown
		const def = mod.default as Record<string, unknown> | undefined
		if (def && typeof def.activate === 'function') return (def.activate as (api: FramedPluginAPI) => unknown).bind(def)
		return null
	}

	// An absolute URL, resolved against document.baseURI (the <base
	// href> Mill set to the plugin's own folder) rather than left
	// relative: a module's relative specifier resolves against the
	// IMPORTING SCRIPT's own URL (this file's own /plugin-frame/
	// location), never the document's <base>, so a relative reference
	// here would resolve to the wrong folder entirely.
	const url = new URL(`main.js?v=${encodeURIComponent(init.version || '')}`, document.baseURI).href
	registerManifestCanvasFaces(canvasTools, init.canvasFaces || [])
		.then(() => import(/* @vite-ignore */ url))
		.then((mod: Record<string, unknown>) => {
			const activate = resolveActivate(mod)
			if (!activate) throw new Error('main.js exports no activate() function')
			return activate(api)
		})
		.then((result) => {
			// exportedObject is kept for onExtensionCall above; the
			// activation-done payload splits it into wire-safe data
			// (every non-function own property, ungated -- only a
			// callable method is "reach") plus just the ALLOWLISTED
			// method names (goal 0364).
			exportedObject = result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined
			const methods: string[] = []
			const data: Record<string, unknown> = {}
			if (exportedObject) {
				for (const key of Object.keys(exportedObject)) {
					const value = exportedObject[key]
					if (typeof value === 'function') {
						if (exportAllowlist.indexOf(key) !== -1) methods.push(key)
					} else {
						data[key] = value
					}
				}
			}
			send({ kind: 'activation-done', exports: { data, methods } })
		})
		.catch((err: unknown) => send({ kind: 'activation-error', error: err instanceof Error ? err.message : String(err) }))
})()
