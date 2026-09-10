// Request tester's own page (docs/goals/0375 S1b): everything that used
// to run in main.js now runs here, inside Mill's sandboxed frame,
// reached only through window.acquireMillApi(). The response used to
// draw through Mill's own output viewer (api.ui.renderOutput); a
// framed extension has no door to that viewer, so this page renders
// its own response instead -- pretty-printed JSON when the body parses
// as JSON, the raw text otherwise.
const mill = window.acquireMillApi()

const HISTORY_KEY = 'history'
const MAX_HISTORY = 10
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']

const methodEl = document.getElementById('method')
const urlEl = document.getElementById('url')
const sendEl = document.getElementById('send')
const authEl = document.getElementById('auth')
const bodyEl = document.getElementById('body')
const statusEl = document.getElementById('status')
const responseEl = document.getElementById('response')
const historyEl = document.getElementById('history')

for (const m of METHODS) {
	const o = document.createElement('option')
	o.value = m
	o.textContent = m
	methodEl.append(o)
}

let authTitle = ''

function renderResponse(body) {
	responseEl.textContent = ''
	try {
		responseEl.textContent = JSON.stringify(JSON.parse(body), null, 2)
	} catch {
		responseEl.textContent = body
	}
}

async function renderHistory() {
	historyEl.replaceChildren()
	const items = (await mill.call('storage.get', HISTORY_KEY)) || []
	if (items.length === 0) {
		const p = document.createElement('div')
		p.textContent = 'Nothing sent yet.'
		p.style.color = 'var(--fgColor-muted)'
		historyEl.append(p)
		return
	}
	for (const item of items) {
		const b = document.createElement('button')
		b.type = 'button'
		b.className = 'history-item'
		b.setAttribute('data-testid', 'tester-history-item')
		// mill.formatDate (goal 0386 S1): the same relative-time phrasing
		// Mill's own interface renders everywhere, not hand-rolled Date math.
		b.textContent = item.method + ' ' + item.url + (item.status ? ' → ' + item.status : '') + (item.at ? ' · ' + mill.formatDate(item.at, 'relative') : '')
		b.addEventListener('click', () => { methodEl.value = item.method; urlEl.value = item.url; bodyEl.value = item.body || '' })
		historyEl.append(b)
	}
}

async function remember(entry) {
	const items = ((await mill.call('storage.get', HISTORY_KEY)) || []).filter((h) => !(h.method === entry.method && h.url === entry.url))
	items.unshift(entry)
	try {
		await mill.call('storage.set', HISTORY_KEY, items.slice(0, MAX_HISTORY))
	} catch (err) {
		void mill.call('notify', { level: 'error', text: 'Could not save this request to history.' })
		console.error(err)
	}
	await renderHistory()
}

sendEl.addEventListener('click', async () => {
	const target = urlEl.value.trim()
	if (!target) { statusEl.textContent = 'Enter an address first.'; return }
	statusEl.textContent = 'Asking… (this request needs your approval in Review)'
	responseEl.textContent = ''
	try {
		const chosen = methodEl.value
		const r = await mill.call('fetch', target, { method: chosen, body: bodyEl.value || undefined, secret: authTitle ? { settingKey: 'auth' } : undefined })
		if (!r.approved) { statusEl.textContent = 'Not allowed' + (r.ruleLabel ? ' (' + r.ruleLabel + ')' : '') + '.'; return }
		statusEl.textContent = r.status + ' · ' + Object.keys(r.headers).length + ' headers'
		renderResponse(r.body)
		await remember({ method: chosen, url: target, body: bodyEl.value, status: r.status, at: Date.now() })
		// The view/title seat's own worked example (goal 0349 S2c): once a
		// send has a result to replay, "Send again" declares
		// when: "plugin.hasResult" in the manifest, so this is the one
		// call that turns the title action on for the rest of the tab's
		// life.
		void mill.call('context.set', 'hasResult', true)
	} catch (err) {
		statusEl.textContent = String(err && err.message ? err.message : err)
	}
})

async function refreshSettings() {
	methodEl.value = String((await mill.call('settings.get', 'defaultMethod')) || 'GET')
	// A secretRef setting answers only its picked vault entry's TITLE,
	// never its value: this page never learns the token.
	authTitle = String((await mill.call('settings.get', 'auth')) || '')
	authEl.textContent = authTitle
		? 'Sends ‘' + authTitle + '’ as a bearer token. Change it in Settings → Extensions.'
		: 'No authorization. Pick a vault entry in Settings → Extensions to send one.'
}

mill.on('settings:changed', () => { void refreshSettings() })
// The host's "Send again" title action (goal 0349 S2b): re-clicks Send
// with whatever this page's own fields currently hold, exactly the
// gesture a person clicking Send themselves would make.
mill.onMessage((message) => {
	if (message && message.type === 'send-again') sendEl.click()
})
void refreshSettings()
void renderHistory()
