// @ts-check
/// <reference path="../../../frontend/plugin-sdk/index.d.ts" />

// Bruno collection -- the real tool stays the authoring plane (docs/
// goals/0308, ADR-0051): a collection is a folder of .bru files with a
// bruno.json at its root, edited and run in Bruno. This object keeps
// the collection on the board by mirroring that bruno.json (source:
// file -- Mill reads the file, the face shows what it says) and names
// the seeded workflow that runs it. No capability: nothing here
// reaches past the mirrored file.
/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	api.registerCanvasObject({
		kind: 'bruno-collection',
		label: 'Bruno collection',
		description: 'A Bruno API collection, by its bruno.json.',
		icon: '🐶',
		group: 'file',
		source: 'file',
		editRoute: 'none',
		defaultPayload: { mirrorPath: '' },
		renderFace(el, ctx) { render(el, ctx) },
	})

	function render(el, ctx) {
		el.replaceChildren()
		el.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:10px 12px;font:12px system-ui;height:100%;min-width:280px;box-sizing:border-box'
		const title = document.createElement('div')
		title.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:600'
		title.setAttribute('data-testid', 'bruno-title')
		const meta = document.createElement('div')
		meta.setAttribute('data-testid', 'bruno-meta')
		meta.style.cssText = 'color:var(--fgColor-muted)'

		const manifest = readManifest(ctx)
		if (!ctx.object.Payload.mirrorPath) {
			title.textContent = '🐶 Bruno collection'
			meta.textContent = 'Enter the path to a collection’s bruno.json.'
		} else if (ctx.mirror && ctx.mirror.failed) {
			title.textContent = '🐶 Bruno collection'
			meta.textContent = 'Could not read ' + ctx.object.Payload.mirrorPath
		} else if (!manifest) {
			title.textContent = '🐶 Bruno collection'
			meta.textContent = 'Reading…'
		} else {
			title.textContent = '🐶 ' + (manifest.name || 'Bruno collection')
			meta.textContent = 'Bruno collection' + (manifest.version ? ' · format v' + manifest.version : '') + ' · runs through "Example: Run a Bruno collection"'
		}

		const input = document.createElement('input')
		input.type = 'text'
		input.placeholder = '/path/to/collection/bruno.json'
		input.value = ctx.object.Payload.mirrorPath || ''
		input.setAttribute('data-testid', 'bruno-path-input')
		input.className = 'nodrag'
		input.style.cssText = 'font:11px ui-monospace,monospace;padding:4px 6px;border:1px solid var(--borderColor-default);border-radius:6px;width:100%;box-sizing:border-box'
		const commit = () => {
			const next = input.value.trim()
			if (next === (ctx.object.Payload.mirrorPath || '')) return
			void ctx.updatePayload({ mirrorPath: next }).catch(() => api.notify({ level: 'error', text: 'Could not save the collection path.' }))
		}
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); commit() }
			e.stopPropagation()
		})
		input.addEventListener('blur', commit)

		el.append(title, meta, input)

		// The collection folder is the manifest's own folder: its requests
		// are the .bru files (one level, plus folders), listed through the
		// files door; "Open in Bruno" hands the folder to the real app.
		const folder = collectionDir(ctx.object.Payload.mirrorPath)
		if (folder && manifest) {
			const actions = document.createElement('div')
			actions.style.cssText = 'display:flex;gap:6px;align-items:center'
			const open = document.createElement('button')
			open.textContent = 'Open in Bruno'
			open.className = 'nodrag'
			open.setAttribute('data-testid', 'bruno-open')
			const status = document.createElement('span')
			status.setAttribute('data-testid', 'bruno-open-status')
			status.style.cssText = 'color:var(--fgColor-muted)'
			open.addEventListener('click', () => {
				status.textContent = 'Asking…'
				ctx.requestGuardedAction('open-app', { app: 'Bruno', path: folder }, 'Open the collection in Bruno')
					.then((r) => { status.textContent = r.approved ? (r.performed ? 'Opened.' : 'Approved.') : 'Not allowed' + (r.ruleLabel ? ' (' + r.ruleLabel + ')' : '') })
					.catch(() => { status.textContent = 'Could not open Bruno.' })
			})
			actions.append(open, status)
			const list = document.createElement('ul')
			list.setAttribute('data-testid', 'bruno-requests')
			list.style.cssText = 'margin:0;padding-left:16px;color:var(--fgColor-default);max-height:140px;overflow:auto'
			api.files.list(folder).then((r) => {
				if (!r.approved) { list.textContent = 'Requests not listed' + (r.ruleLabel ? ' (' + r.ruleLabel + ')' : '') + '.'; return }
				const requests = r.entries.filter((e) => !e.isDir && e.name.endsWith('.bru'))
				const folders = r.entries.filter((e) => e.isDir && e.name !== 'environments')
				for (const f of folders) { const li = document.createElement('li'); li.textContent = f.name + '/'; list.append(li) }
				for (const q of requests) { const li = document.createElement('li'); li.textContent = q.name.replace(/\.bru$/, ''); list.append(li) }
				if (!list.childElementCount) list.textContent = 'No requests yet.'
			}).catch(() => { list.textContent = 'Could not list the requests.' })
			el.append(actions, list)
		}
	}

	// collectionDir: the folder holding bruno.json (an absolute path).
	function collectionDir(mirrorPath) {
		const p = (mirrorPath || '').trim()
		if (!p.startsWith('/')) return ''
		return p.slice(0, p.lastIndexOf('/')) || '/'
	}

	// readManifest decodes the mirrored bruno.json (a data: URL the host
	// hands over once the file is read); null until it is available.
	function readManifest(ctx) {
		const url = ctx.mirror && ctx.mirror.dataUrl
		if (!url) return null
		try {
			const comma = url.indexOf(',')
			const text = url.slice(0, comma).includes(';base64') ? atob(url.slice(comma + 1)) : decodeURIComponent(url.slice(comma + 1))
			const parsed = JSON.parse(text)
			return parsed && typeof parsed === 'object' ? parsed : null
		} catch {
			return null
		}
	}
}
