// Bookmark -- Mill's reference runtime plugin (docs/goals/0249).
// Plain ESM, no build step: copy this folder into the app's plugins
// directory (Settings > Extensions > Open plugins folder) and reload.
//
// It contributes one canvas object on the object contract: a web
// address pinned to the board (source: url). The URL is edited right
// on the face (editRoute: inline); Open never touches the browser
// itself -- it asks Mill for the guarded open-url action, which the
// owner's guardrail rules evaluate per use.
//
// Its two declared settings (manifest contributes.settings) show the
// settings door: Mill renders the controls in the plugin's Extensions
// row and stores the values; the plugin only reads them
// (api.settings.get) and re-renders its live faces when one changes
// (api.settings.onChange) -- renderFace itself re-runs on object data
// changes only.

export function activate(api) {
	// Live faces, so a settings change can redraw them.
	const faces = new Map()
	const redrawAll = () => {
		for (const [el, ctx] of faces) {
			if (!el.isConnected) { faces.delete(el); continue }
			render(el, ctx)
		}
	}
	api.settings.onChange('titleStyle', redrawAll)
	api.settings.onChange('placeholderTitle', redrawAll)

	const titleFor = (url) => {
		if (!url) return api.settings.get('placeholderTitle')
		return api.settings.get('titleStyle') === 'address' ? withScheme(url) : new URL(withScheme(url)).hostname
	}

	api.registerCanvasObject({
		kind: 'bookmark',
		label: 'Bookmark',
		description: 'A web address pinned to the board.',
		icon: '🔖',
		source: 'url',
		editRoute: 'inline',
		defaultPayload: { url: '', title: '' },
		renderFace(el, ctx) {
			faces.set(el, ctx)
			render(el, ctx)
		},
	})

	function render(el, ctx) {
		// Rebuild the face from the object's current data. All text
		// lands via textContent/value -- never markup -- so a URL can
		// never inject anything.
		el.replaceChildren()
		el.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px 12px;font:12px system-ui;height:100%;box-sizing:border-box'

		const title = document.createElement('div')
		title.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:600'
		const glyph = document.createElement('span')
		glyph.textContent = '🔖'
		const titleText = document.createElement('span')
		titleText.textContent = titleFor((ctx.object.Payload.url || '').trim())
		titleText.setAttribute('data-testid', 'bookmark-title')
		title.append(glyph, titleText)

		const input = document.createElement('input')
		input.type = 'text'
		input.placeholder = 'https://…'
		input.value = ctx.object.Payload.url || ''
		input.setAttribute('data-testid', 'bookmark-url-input')
		input.style.cssText = 'font:11px ui-monospace,monospace;padding:4px 6px;border:1px solid #d0d7de;border-radius:6px;width:100%;box-sizing:border-box'
		// Commit on Enter/blur, not per keystroke -- each payload
		// write re-renders this face, which would rebuild the input
		// under the caret mid-word.
		const commit = () => {
			const next = input.value.trim()
			if (next === (ctx.object.Payload.url || '')) return
			void ctx.updatePayload({ url: next, title: next ? new URL(withScheme(next)).hostname : '' }).catch(() => {
				// A failed save reaches the user through Mill's own notice
				// surface, never only the console.
				api.notify({ level: 'error', text: 'Could not save the bookmark address.' })
			})
		}
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); commit() }
			e.stopPropagation() // board shortcuts stay out of typing
		})
		input.addEventListener('blur', commit)

		const row = document.createElement('div')
		row.style.cssText = 'display:flex;align-items:center;gap:8px'
		const open = document.createElement('button')
		open.type = 'button'
		open.textContent = 'Open'
		open.setAttribute('data-testid', 'bookmark-open')
		open.style.cssText = 'font:11px system-ui;padding:3px 10px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;cursor:pointer'
		const status = document.createElement('span')
		status.setAttribute('data-testid', 'bookmark-status')
		status.style.cssText = 'font:11px system-ui;color:#57606a'
		open.addEventListener('click', async () => {
			const url = withScheme((ctx.object.Payload.url || '').trim())
			if (!url) { status.textContent = 'Enter an address first.'; return }
			status.textContent = 'Asking…'
			try {
				const result = await ctx.requestGuardedAction('open-url', { url }, `Open ${url} in the browser`)
				status.textContent = result.approved ? 'Opened.' : 'Not allowed' + (result.ruleLabel ? ` (${result.ruleLabel}).` : '.')
			} catch (err) {
				status.textContent = String(err && err.message ? err.message : err)
			}
		})
		row.append(open, status)

		el.append(title, input, row)
	}
}

function withScheme(url) {
	if (!url) return url
	return /^https?:\/\//.test(url) ? url : 'https://' + url
}
