// Web clipper -- a page becomes a note (docs/goals/0282), on the public
// doors alone: api.fetch (guarded; the any-host declaration means
// Review asks every time), the vendored Readability for the article,
// api.convert.htmlToMarkdown (the converter every paste uses), and
// api.content.createNote (guarded like every plugin write). The clip
// object holds the address and the outcome; the note is the artifact.
import { Readability } from './vendor/readability.js'

export function activate(api) {
	// In-flight status per object: the host re-renders a face whenever
	// the object's data changes (its first measured size lands while a
	// clip is asking in Review), and a rebuilt face must show the same
	// status, not a blank one.
	const statusByID = new Map()

	api.registerCanvasObject({
		kind: 'clip',
		label: 'Web clipper',
		description: "Clips a page's article into a note.",
		icon: '✂️',
		group: 'knowledge',
		source: 'url',
		editRoute: 'inline',
		defaultPayload: { url: '', clipped: '' },
		renderFace(el, ctx) { render(el, ctx) },
	})

	function render(el, ctx) {
		el.replaceChildren()
		el.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px 12px;font:12px system-ui;height:100%;min-width:280px;box-sizing:border-box'

		const title = document.createElement('div')
		title.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:600'
		title.textContent = '✂️ Web clipper'

		const input = document.createElement('input')
		input.type = 'text'
		input.placeholder = 'https://…'
		input.value = ctx.object.Payload.url || ''
		input.setAttribute('data-testid', 'clip-url-input')
		input.className = 'nodrag'
		input.style.cssText = 'font:11px ui-monospace,monospace;padding:4px 6px;border:1px solid #d0d7de;border-radius:6px;width:100%;box-sizing:border-box'
		const commit = () => {
			const next = input.value.trim()
			if (next === (ctx.object.Payload.url || '')) return
			void ctx.updatePayload({ url: next }).catch(() => api.notify({ level: 'error', text: 'Could not save the address.' }))
		}
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); commit() }
			e.stopPropagation()
		})
		input.addEventListener('blur', commit)

		const row = document.createElement('div')
		row.style.cssText = 'display:flex;align-items:center;gap:8px'
		const clip = document.createElement('button')
		clip.type = 'button'
		clip.textContent = ctx.object.Payload.clipped ? 'Clip again' : 'Clip to a note'
		clip.setAttribute('data-testid', 'clip-run')
		clip.className = 'nodrag'
		clip.style.cssText = 'font:11px system-ui;padding:3px 10px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;cursor:pointer'
		const status = document.createElement('span')
		status.setAttribute('data-testid', 'clip-status')
		status.style.cssText = 'font:11px system-ui;color:#57606a'
		status.textContent = statusByID.get(ctx.object.ID) || (ctx.object.Payload.clipped ? 'Clipped → ' + ctx.object.Payload.clipped : '')
		const setStatus = (text) => { statusByID.set(ctx.object.ID, text); status.textContent = text }
		clip.addEventListener('click', () => { void clipPage(ctx, input.value.trim(), setStatus) })
		row.append(clip, status)

		el.append(title, input, row)
	}

	async function clipPage(ctx, url, onStatus) {
		if (!url) { onStatus('Enter an address first.'); return }
		if (!/^https?:\/\//.test(url)) url = 'https://' + url
		onStatus('Asking… approve it in Review')
		let fetched
		try {
			fetched = await api.fetch(url, { method: 'GET' })
		} catch (err) {
			onStatus("Couldn't fetch: " + String(err && err.message ? err.message : err))
			return
		}
		if (!fetched.approved) { onStatus('Not allowed' + (fetched.ruleLabel ? ' (' + fetched.ruleLabel + ')' : '') + '.'); return }
		if (fetched.status < 200 || fetched.status >= 300) { onStatus("Couldn't fetch: the page answered " + fetched.status + '.'); return }

		const doc = new DOMParser().parseFromString(fetched.body, 'text/html')
		const base = doc.createElement('base')
		base.href = url
		doc.head.append(base)
		const article = new Readability(doc).parse()
		if (!article || !article.content || !article.textContent.trim()) { onStatus('Nothing readable on that page.'); return }

		onStatus('Converting…')
		let markdown
		try {
			markdown = await api.convert.htmlToMarkdown(article.content)
		} catch (err) {
			onStatus("Couldn't convert: " + String(err && err.message ? err.message : err))
			return
		}
		const heading = (article.title || url).trim()
		const text = '# ' + heading + '\n\n' + markdown.trim() + '\n\nSource: ' + url

		onStatus('Saving… approve it in Review')
		try {
			const w = await api.content.createNote({ text })
			if (!w.approved) { onStatus("Couldn't save" + (w.ruleLabel ? ' (' + w.ruleLabel + ')' : '') + '.'); return }
		} catch (err) {
			onStatus("Couldn't save: " + String(err && err.message ? err.message : err))
			return
		}
		await ctx.updatePayload({ url, clipped: heading }).catch(() => {})
		onStatus('Clipped → ' + heading)
	}
}
