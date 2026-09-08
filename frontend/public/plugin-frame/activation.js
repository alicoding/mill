// A third-party plugin's own activation, run inside a hidden sandboxed
// frame (docs/goals/0375 S1b): main.js's activate(api) runs HERE, not
// in Mill's own document, closing the same-DOM guardrail bypass every
// other framed surface already closed. Distinct from bootstrap.js --
// there is no plugin-authored page in this document, so this script
// builds the full MillPluginAPI shape a same-DOM plugin holds, over
// messages, and imports main.js itself once that door exists.
//
// It runs on an OPAQUE origin (sandbox, no allow-same-origin): nothing
// here can reach Mill's document, cookies or storage, and postMessage
// to the parent is the only channel that exists.
(function () {
	var initMeta = document.querySelector('meta[name="mill-frame-init"]')
	var init = { pluginId: '', millVersion: '', version: '', settings: {}, storage: {} }
	try {
		if (initMeta) init = JSON.parse(initMeta.getAttribute('content') || '{}')
	} catch (err) {
		console.error('the activation frame could not read its own mount data', err)
	}

	var pluginId = init.pluginId
	var settingsSnapshot = init.settings || {}
	var storageSnapshot = init.storage || {}

	var pending = new Map() // call id -> {resolve, reject}, this frame's own outbound calls
	var seq = 0
	var runHandlers = new Map() // command id -> run()
	var viewMessageHandlers = new Map() // view id -> onMessage()
	var captureMessageHandlers = new Map() // capture id -> onMessage()
	var settingsHandlers = new Map() // subId -> {key, fn}
	var contentsHandlers = new Map() // subId -> {kinds, fn}

	function send(msg) {
		msg.mill = 1
		window.parent.postMessage(msg, '*')
	}

	// call is this frame's half of the same request/reply shape every
	// framed page's window.acquireMillApi().call() uses (pluginFrameBridge.ts
	// answers it identically): a door not on the host's activation
	// method table rejects, naming itself.
	function call(method) {
		var args = Array.prototype.slice.call(arguments, 1)
		return new Promise(function (resolve, reject) {
			var id = ++seq
			pending.set(id, { resolve: resolve, reject: reject })
			send({ id: id, kind: 'call', method: method, args: args })
		})
	}

	function onReply(data) {
		var waiting = pending.get(data.id)
		if (!waiting) return
		pending.delete(data.id)
		if (data.ok) waiting.resolve(data.result)
		else waiting.reject(new Error(data.error || 'the call failed'))
	}

	// onCommandRun answers the host's own reverse call: it asked one of
	// THIS plugin's registered commands to run, and waits for the exact
	// result runCommand() sees anywhere else.
	function onCommandRun(data) {
		var run = runHandlers.get(data.id)
		if (!run) { send({ kind: 'command.result', callId: data.callId, ok: false, error: 'command "' + data.id + '" is not registered' }); return }
		Promise.resolve()
			.then(function () { return run() })
			.then(function () { send({ kind: 'command.result', callId: data.callId, ok: true }) })
			.catch(function (err) { send({ kind: 'command.result', callId: data.callId, ok: false, error: err && err.message ? err.message : String(err) }) })
	}

	function onEvent(data) {
		if (data.event === 'view.message') {
			var vh = viewMessageHandlers.get(data.payload.id)
			if (vh) vh(data.payload.payload)
		} else if (data.event === 'capture.message') {
			var ch = captureMessageHandlers.get(data.payload.id)
			if (ch) ch(data.payload.payload)
		} else if (data.event === 'settings.changed') {
			var sh = settingsHandlers.get(data.payload.subId)
			if (sh) { settingsSnapshot[sh.key] = data.payload.value; sh.fn(data.payload.value) }
		} else if (data.event === 'contents.changed') {
			var ch2 = contentsHandlers.get(data.payload.subId)
			if (ch2 && (!ch2.kinds || ch2.kinds.indexOf(data.payload.kind) !== -1)) ch2.fn({ id: data.payload.id, kind: data.payload.kind })
		}
	}

	window.addEventListener('message', function (event) {
		if (event.source !== window.parent) return
		var data = event.data
		if (!data || data.mill !== 1) return
		if (data.kind === 'event') onEvent(data)
		else if (data.kind === 'command.run') onCommandRun(data)
		else if (data.id !== undefined) onReply(data)
	})

	function notAvailable(name) {
		return function () { throw new Error('plugin ' + pluginId + ': ' + name + ' is not available for a framed extension; use an entry page') }
	}

	// fetchJSON/storage.pushList/storage.getList/formatDate (goal 0386
	// S1) mirror hostApi.ts's own pure sugar (buildFetchJSON,
	// buildPluginStorage, formatPluginDate) over the doors already
	// bridged above -- kept in sync by hand, like resolveActivate below:
	// this file is served static, never built from the loader's
	// TypeScript.
	function fetchJSON(url, requestInit) {
		return call('fetch', url, requestInit || {}).then(function (r) {
			if (!r.approved) return { ok: false, status: r.status, errorText: r.ruleLabel || 'Not allowed.' }
			if (r.status < 200 || r.status >= 300) return { ok: false, status: r.status, errorText: r.body ? r.body.slice(0, 500) : ('The server answered ' + r.status + '.') }
			try {
				return { ok: true, status: r.status, data: JSON.parse(r.body) }
			} catch (err) {
				return { ok: false, status: r.status, errorText: 'The response was not valid JSON.' }
			}
		})
	}

	var RELATIVE_UNITS = [['year', 31536000000], ['month', 2592000000], ['week', 604800000], ['day', 86400000], ['hour', 3600000], ['minute', 60000]]
	var relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
	function formatDate(iso, style) {
		var ms = Date.parse(iso)
		if (isNaN(ms)) return '—'
		if (style === 'short') return new Date(ms).toLocaleDateString()
		if (style === 'long') return new Date(ms).toLocaleString()
		var diffMs = ms - Date.now()
		var absDiffMs = Math.abs(diffMs)
		if (absDiffMs < 604800000) {
			for (var i = 0; i < RELATIVE_UNITS.length; i++) {
				var unit = RELATIVE_UNITS[i][0], unitMs = RELATIVE_UNITS[i][1]
				if (absDiffMs >= unitMs || unit === 'minute') {
					var value = Math.round(diffMs / unitMs)
					return value === 0 ? 'just now' : relativeFormatter.format(value, unit)
				}
			}
		}
		return new Date(ms).toLocaleDateString()
	}

	var api = Object.freeze({
		millVersion: init.millVersion,
		pluginId: pluginId,
		settings: Object.freeze({
			get: function (key) { return settingsSnapshot[key] },
			onChange: function (key, fn) {
				var subId = 0
				call('subscribe', { topic: 'settings', key: key }).then(function (r) {
					subId = r.subId
					settingsHandlers.set(subId, { key: key, fn: fn })
				}).catch(function (err) { console.error('plugin ' + pluginId + ': settings.onChange failed', err) })
				return function () {
					settingsHandlers.delete(subId)
					void call('unsubscribe', { subId: subId })
				}
			},
		}),
		notify: function (input) { void call('notify', input); return function () {} },
		storage: Object.freeze({
			get: function (key) { return storageSnapshot[key] },
			keys: function () { return Object.keys(storageSnapshot) },
			set: function (key, value) { storageSnapshot[key] = value; return call('storage.set', key, value).then(function () {}) },
			delete: function (key) { delete storageSnapshot[key]; return call('storage.delete', key).then(function () {}) },
			getList: function (key) {
				var v = storageSnapshot[key]
				return Promise.resolve(Array.isArray(v) ? v.slice() : [])
			},
			pushList: function (key, item, opts) {
				var list = Array.isArray(storageSnapshot[key]) ? storageSnapshot[key].slice() : []
				var dedupeBy = opts && opts.dedupeBy
				if (dedupeBy) {
					var itemKey = dedupeBy(item)
					list = list.filter(function (x) { return dedupeBy(x) !== itemKey })
				}
				list.unshift(item)
				var max = opts && opts.max
				if (typeof max === 'number') list = list.slice(0, max)
				storageSnapshot[key] = list
				return call('storage.set', key, list).then(function () {})
			},
		}),
		query: function (q) { return call('query', q || {}) },
		kinds: function () { return call('kinds') },
		open: function (cardId) { void call('open', cardId) },
		on: function (event, handler, filter) {
			if (event !== 'contents:changed') throw new Error('plugin ' + pluginId + ': unknown event "' + event + '"')
			var subId = 0
			call('subscribe', { topic: 'contents:changed', kinds: filter && filter.kinds }).then(function (r) {
				subId = r.subId
				contentsHandlers.set(subId, { kinds: filter && filter.kinds, fn: handler })
			}).catch(function (err) { console.error('plugin ' + pluginId + ': on("contents:changed") failed', err) })
			return function () {
				contentsHandlers.delete(subId)
				void call('unsubscribe', { subId: subId })
			}
		},
		fetch: function (url, requestInit) { return call('fetch', url, requestInit || {}) },
		fetchJSON: fetchJSON,
		formatDate: formatDate,
		content: Object.freeze({
			createNote: function (input) { return call('content.createNote', input) },
			createCard: function (input) { return call('content.createCard', input) },
			updateCard: function (id, patch) { return call('content.updateCard', id, patch) },
			appendListRow: function (listId, values) { return call('content.appendListRow', listId, values) },
			createList: function (input) { return call('content.createList', input) },
			setCardFields: function (cardId, fields) { return call('content.setCardFields', cardId, fields) },
		}),
		files: Object.freeze({ list: function (path) { return call('files.list', path) } }),
		convert: Object.freeze({
			htmlToMarkdown: function (html) { return call('convert.htmlToMarkdown', html) },
			markdownToHtml: function (md) { return call('convert.markdownToHtml', md) },
		}),
		requestGuardedAction: function (kind, attributes, description) { return call('requestGuardedAction', kind, attributes, description) },
		registerCanvasObject: notAvailable('registerCanvasObject'),
		registerCommand: function (decl) {
			runHandlers.set(decl.id, decl.run)
			void call('register.command', { id: decl.id, label: decl.label }).catch(function (err) { console.error('plugin ' + pluginId + ': registerCommand failed', err) })
		},
		registerView: function (decl) {
			if (decl.onMessage) viewMessageHandlers.set(decl.id, decl.onMessage)
			void call('register.view', { id: decl.id, hasMessageHandler: !!decl.onMessage }).catch(function (err) { console.error('plugin ' + pluginId + ': registerView failed', err) })
			return { postMessage: function (message) { void call('view.postMessage', { id: decl.id, payload: message }) } }
		},
		registerCapture: function (decl) {
			if (decl.onMessage) captureMessageHandlers.set(decl.id, decl.onMessage)
			void call('register.capture', { id: decl.id, hasMessageHandler: !!decl.onMessage }).catch(function (err) { console.error('plugin ' + pluginId + ': registerCapture failed', err) })
			return { postMessage: function (message) { void call('capture.postMessage', { id: decl.id, payload: message }) } }
		},
		// el has nowhere to mount into here: a framed activation's own
		// document is never attached anywhere Mill's UI can reach, unlike
		// a canvas object's own face element.
		ui: Object.freeze({ renderOutput: notAvailable('ui.renderOutput'), el: notAvailable('ui.el') }),
	})

	// resolveActivate mirrors loader.ts's own function of the same name:
	// a module exports activate() directly, as its default, or as
	// default.activate. Kept in sync by hand -- this file is served
	// static, never built from the loader's TypeScript.
	function resolveActivate(mod) {
		if (typeof mod.activate === 'function') return mod.activate
		if (typeof mod.default === 'function') return mod.default
		if (mod.default && typeof mod.default.activate === 'function') return mod.default.activate.bind(mod.default)
		return null
	}

	// An absolute URL, resolved against document.baseURI (the <base
	// href> Mill set to the plugin's own folder) rather than left
	// relative: a module's relative specifier resolves against the
	// IMPORTING SCRIPT's own URL (this file's own /plugin-frame/
	// location), never the document's <base>, so a relative reference
	// here would resolve to the wrong folder entirely.
	var url = new URL('main.js?v=' + encodeURIComponent(init.version || ''), document.baseURI).href
	import(/* webpackIgnore: true */ url)
		.then(function (mod) {
			var activate = resolveActivate(mod)
			if (!activate) throw new Error('main.js exports no activate() function')
			return activate(api)
		})
		.then(function () { send({ kind: 'activation-done' }) })
		.catch(function (err) { send({ kind: 'activation-error', error: err && err.message ? err.message : String(err) }) })
})()
