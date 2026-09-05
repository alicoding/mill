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
(function () {
	var initMeta = document.querySelector('meta[name="mill-frame-init"]')
	var init = { theme: { mode: 'light', scheme: 'light' }, state: undefined, context: {} }
	try {
		if (initMeta) init = JSON.parse(initMeta.getAttribute('content') || '{}')
	} catch (err) {
		console.error('the frame could not read its own mount data', err)
	}

	var pending = new Map()
	var messageHandlers = []
	var eventHandlers = new Map()
	var seq = 0
	var theme = init.theme || { mode: 'light', scheme: 'light' }
	var context = init.context || {}
	var state = init.state
	var vsCodeAcquired = false

	function applyTheme(next, tokens) {
		theme = next
		var root = document.documentElement
		root.setAttribute('data-mill-theme', next.mode)
		root.setAttribute('data-mill-scheme', next.scheme)
		if (typeof tokens !== 'string') return
		var style = document.getElementById('mill-tokens')
		if (!style) {
			style = document.createElement('style')
			style.id = 'mill-tokens'
			document.head.appendChild(style)
		}
		style.textContent = tokens
	}

	function send(msg) {
		msg.mill = 1
		window.parent.postMessage(msg, '*')
	}

	function subscribe(list, fn) {
		list.push(fn)
		return function () {
			var at = list.indexOf(fn)
			if (at >= 0) list.splice(at, 1)
		}
	}

	function onHostEvent(data) {
		if (data.event === 'theme:changed') applyTheme(data.payload, data.tokens)
		if (data.event === 'ctx') context = data.payload
		var handlers = (eventHandlers.get(data.event) || []).slice()
		for (var i = 0; i < handlers.length; i++) handlers[i](data.payload)
	}

	function onReply(data) {
		var waiting = pending.get(data.id)
		if (!waiting) return
		pending.delete(data.id)
		if (data.ok) waiting.resolve(data.result)
		else waiting.reject(new Error(data.error || 'the call failed'))
	}

	window.addEventListener('message', function (event) {
		if (event.source !== window.parent) return
		var data = event.data
		if (!data || data.mill !== 1) return
		if (data.kind === 'event') onHostEvent(data)
		else if (data.kind === 'message') {
			var handlers = messageHandlers.slice()
			for (var i = 0; i < handlers.length; i++) handlers[i](data.payload)
		} else if (data.id !== undefined) onReply(data)
	})

	function postMessage(message) { send({ kind: 'message', payload: message }) }
	function getState() { return state }
	function setState(next) {
		state = next
		send({ kind: 'state', payload: next })
		return next
	}

	var api = {
		postMessage: postMessage,
		getState: getState,
		setState: setState,
		onMessage: function (fn) { return subscribe(messageHandlers, fn) },
		call: function (method) {
			var args = Array.prototype.slice.call(arguments, 1)
			return new Promise(function (resolve, reject) {
				var id = ++seq
				pending.set(id, { resolve: resolve, reject: reject })
				send({ id: id, kind: 'call', method: method, args: args })
			})
		},
		on: function (event, fn) {
			var list = eventHandlers.get(event) || []
			eventHandlers.set(event, list)
			return subscribe(list, fn)
		},
	}
	Object.defineProperty(api, 'theme', { get: function () { return theme }, enumerable: true })
	Object.defineProperty(api, 'context', { get: function () { return context }, enumerable: true })
	Object.freeze(api)

	applyTheme(theme)
	window.acquireMillApi = function () { return api }
	// The webview shape a widely-used editor's extension pages already
	// speak, verbatim, so such a page drops in unchanged: three methods,
	// and acquiring it twice throws.
	window.acquireVsCodeApi = function () {
		if (vsCodeAcquired) throw new Error('An instance of the VS Code API has already been acquired')
		vsCodeAcquired = true
		return Object.freeze({ postMessage: postMessage, getState: getState, setState: setState })
	}
	send({ kind: 'ready' })
})()
