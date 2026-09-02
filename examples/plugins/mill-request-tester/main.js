// Request tester -- Mill's example of a USEFUL extension built only on
// the plugin doors (docs/goals/0291): a work tab (registerView), the
// guarded network (api.fetch over an any-host declaration, so every
// request asks first), per-plugin storage (request history), and a
// declared setting (the default method). No build step.
//
// Every send goes through Mill's guardrail: with "*" declared, each
// request parks for approval in Review -- Mill never lets a plugin
// choose its own hosts silently.

export function activate(api) {
	const HISTORY_KEY = 'history'
	const MAX_HISTORY = 10

	api.registerView({ id: 'tester', render(el) { render(el) } })

	function render(el) {
		el.replaceChildren()
		el.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:16px;font:13px system-ui;height:100%;box-sizing:border-box;overflow:auto'

		const row = document.createElement('div')
		row.style.cssText = 'display:flex;gap:8px;align-items:center'
		const method = document.createElement('select')
		for (const m of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) { const o = document.createElement('option'); o.value = m; o.textContent = m; method.append(o) }
		method.value = String(api.settings.get('defaultMethod') || 'GET')
		method.setAttribute('data-testid', 'tester-method')
		const url = document.createElement('input')
		url.type = 'text'
		url.placeholder = 'https://…'
		url.setAttribute('data-testid', 'tester-url')
		url.style.cssText = 'flex:1;font:12px ui-monospace,monospace;padding:6px 8px;border:1px solid #d0d7de;border-radius:6px'
		const send = document.createElement('button')
		send.type = 'button'
		send.textContent = 'Send'
		send.setAttribute('data-testid', 'tester-send')
		send.style.cssText = 'font:12px system-ui;padding:6px 12px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;cursor:pointer'
		row.append(method, url, send)

		const body = document.createElement('textarea')
		body.placeholder = 'Request body (optional)'
		body.setAttribute('data-testid', 'tester-body')
		body.style.cssText = 'font:12px ui-monospace,monospace;min-height:60px;padding:6px 8px;border:1px solid #d0d7de;border-radius:6px'

		const status = document.createElement('div')
		status.setAttribute('data-testid', 'tester-status')
		status.style.cssText = 'color:#57606a'

		const response = document.createElement('pre')
		response.setAttribute('data-testid', 'tester-response')
		response.style.cssText = 'font:12px ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:8px;min-height:80px;margin:0'

		const historyTitle = document.createElement('div')
		historyTitle.textContent = 'Recent requests'
		historyTitle.style.cssText = 'font-weight:600;margin-top:8px'
		const history = document.createElement('div')
		history.setAttribute('data-testid', 'tester-history')
		history.style.cssText = 'display:flex;flex-direction:column;gap:4px'

		const renderHistory = () => {
			history.replaceChildren()
			const items = api.storage.get(HISTORY_KEY) || []
			if (items.length === 0) { const p = document.createElement('div'); p.textContent = 'Nothing sent yet.'; p.style.color = '#57606a'; history.append(p); return }
			for (const item of items) {
				const b = document.createElement('button')
				b.type = 'button'
				b.setAttribute('data-testid', 'tester-history-item')
				b.textContent = item.method + ' ' + item.url + (item.status ? ' → ' + item.status : '')
				b.style.cssText = 'text-align:left;font:12px ui-monospace,monospace;padding:4px 8px;border:1px solid #d0d7de;border-radius:6px;background:#fff;cursor:pointer'
				b.addEventListener('click', () => { method.value = item.method; url.value = item.url; body.value = item.body || '' })
				history.append(b)
			}
		}

		const remember = async (entry) => {
			const items = (api.storage.get(HISTORY_KEY) || []).filter((h) => !(h.method === entry.method && h.url === entry.url))
			items.unshift(entry)
			await api.storage.set(HISTORY_KEY, items.slice(0, MAX_HISTORY)).catch(console.error)
			renderHistory()
		}

		send.addEventListener('click', async () => {
			const target = url.value.trim()
			if (!target) { status.textContent = 'Enter an address first.'; return }
			status.textContent = 'Asking… (this request needs your approval in Review)'
			response.textContent = ''
			try {
				const r = await api.fetch(target, { method: method.value, body: body.value || undefined })
				if (!r.approved) { status.textContent = 'Not allowed' + (r.ruleLabel ? ' (' + r.ruleLabel + ')' : '') + '.'; return }
				status.textContent = r.status + ' · ' + Object.keys(r.headers).length + ' headers'
				response.textContent = r.body
				await remember({ method: method.value, url: target, body: body.value, status: r.status, at: Date.now() })
			} catch (err) {
				status.textContent = String(err && err.message ? err.message : err)
			}
		})

		el.append(row, body, status, response, historyTitle, history)
		renderHistory()
	}
}
