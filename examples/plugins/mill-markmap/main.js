// @ts-check
/// <reference path="../../../frontend/plugin-sdk/index.d.ts" />

// Mind map -- a VIEW over one note's headings (docs/goals/0283). The
// note stays the only document: this object holds a reference to it
// (payload.noteId) and redraws from api.query whenever the board's
// change event names that note. Plain ESM; the rendering engine
// (markmap-lib + markmap-view, MIT) is the one bundle under vendor/,
// built by scripts/vendor-markmap.sh and served through the plugin
// asset route -- nothing loads from the network. The face is a
// drawing fitted to its box (paintMap below), not a live pan/zoom
// viewer: the engine's own geometry assumes an unscaled svg.
import { Transformer, Markmap, globalCSS } from './vendor/markmap.js'

const CSS_ID = 'mill-markmap-css'

/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	const transformer = new Transformer()
	// Live faces: el -> { ctx, noteId, svg, mm, ro }, so a change event
	// can redraw exactly the faces it concerns.
	const faces = new Map()
	let notes = null
	const listNotes = async () => {
		if (!notes) notes = api.query({ kind: 'note' })
		return notes
	}

	api.on('contents:changed', ({ id }) => {
		notes = null
		for (const [el, face] of faces) {
			if (!el.isConnected) { dispose(face); faces.delete(el); continue }
			// A map redraws when ITS note changed (edited, renamed,
			// deleted); a picker redraws on any change, since the list of
			// notes it offers may have changed.
			if (!face.noteId || face.noteId === id) void render(el, face.ctx)
		}
	})

	api.registerCanvasObject({
		kind: 'mindmap',
		label: 'Mind map',
		description: "A note's headings as a mind map, following the note as it changes.",
		icon: '🧠',
		group: 'knowledge',
		source: 'board-local',
		editRoute: 'none',
		dragBand: true,
		defaultPayload: {},
		menuItems: [
			{
				id: 'change-source',
				label: 'Change source note…',
				enabled: (ctx) => !!(ctx.object.Payload.noteId || '').trim(),
				// An empty value deletes the key; the face falls back to
				// the picker.
				run: (ctx) => { void ctx.updatePayload({ noteId: '' }).catch(saveFailed) },
			},
		],
		renderFace(el, ctx) {
			const face = faces.get(el) || { noteId: null, note: null, svg: null, ro: null }
			face.ctx = ctx
			faces.set(el, face)
			void render(el, ctx)
		},
	})

	const saveFailed = () => { api.notify({ level: 'error', text: 'Could not save which note the mind map shows.' }) }

	async function render(el, ctx) {
		const noteId = (ctx.object.Payload.noteId || '').trim()
		const list = await listNotes()
		const face = faces.get(el)
		if (!face || !el.isConnected || face.ctx !== ctx) return
		if (!noteId) { renderPicker(el, face, list, null); return }
		const note = list.find((n) => n.id === noteId)
		if (!note) { renderPicker(el, face, list, 'The note this map showed is gone.'); return }
		renderMap(el, face, note)
	}

	function renderMap(el, face, note) {
		ensureCSS()
		if (!face.svg || face.svg.parentNode !== el) {
			dispose(face)
			el.replaceChildren()
			// An unsized object takes its face's own size: give the map a
			// real footprint until the user resizes it (then the host's box
			// is the size, and 100% fills it).
			el.className = 'mill-markmap-face'
			el.style.cssText = 'position:relative;height:100%;min-width:360px;min-height:240px;overflow:hidden;background:var(--bgColor-default);color:var(--fgColor-default);border-radius:inherit'
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
			svg.setAttribute('data-testid', 'mindmap-svg')
			svg.setAttribute('class', 'markmap')
			svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
			el.append(svg)
			face.svg = svg
			face.ro = new ResizeObserver(() => { if (face.note) void paintMap(face, face.note) })
			face.ro.observe(el)
		}
		face.noteId = note.id
		face.note = note
		void paintMap(face, note)
	}

	// paintMap lays the map out OFF the board and copies the fitted
	// drawing into the face. The engine measures its labels and fits
	// its layout from screen rectangles, but the board scales its
	// objects with the canvas zoom -- rendered in place, every label
	// measured that much too narrow and the map huddled in a corner.
	// The host's off-board stage (ctx.mountOffBoard) gives the engine an
	// unscaled box the size of the face; the face then shows the result
	// as a drawing that zooms with the board like any other object.
	let paintSerial = 0
	async function paintMap(face, note) {
		const svg = face.svg
		if (!svg || !svg.isConnected) return
		const serial = ++paintSerial
		const width = Math.max(1, svg.clientWidth)
		const height = Math.max(1, svg.clientHeight)
		const stage = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
		stage.setAttribute('class', 'markmap')
		stage.style.cssText = `width:${width}px;height:${height}px;display:block`
		const detach = face.ctx.mountOffBoard(stage, { w: width, h: height })
		const { root } = transformer.transform(headingsMarkdown(note))
		const mm = Markmap.create(stage, { autoFit: false, duration: 0, fitRatio: 0.92 })
		let drawing = ''
		try {
			await mm.setData(root)
			await mm.fit()
			drawing = stage.innerHTML
		} finally {
			mm.destroy()
			detach()
		}
		if (serial === paintSerial && svg.isConnected) {
			svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
			svg.innerHTML = drawing
		}
	}

	function renderPicker(el, face, list, notice) {
		dispose(face)
		face.noteId = null
		el.replaceChildren()
		el.className = ''
		el.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:12px;font:12px system-ui;height:100%;min-width:280px;min-height:96px;box-sizing:border-box;background:var(--bgColor-default);border-radius:inherit'
		if (notice) {
			const p = document.createElement('div')
			p.setAttribute('data-testid', 'mindmap-notice')
			p.style.cssText = 'color:var(--fgColor-muted)'
			p.textContent = notice
			el.append(p)
		}
		const label = document.createElement('label')
		label.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-weight:600'
		label.textContent = "Show a note's headings as a mind map"
		const select = document.createElement('select')
		select.setAttribute('data-testid', 'mindmap-note-picker')
		select.className = 'nodrag'
		select.style.cssText = 'font:12px system-ui;padding:4px 6px;border:1px solid var(--borderColor-default);border-radius:6px;font-weight:400;max-width:100%'
		const first = document.createElement('option')
		first.value = ''
		first.textContent = list.length ? 'Choose a note…' : 'Add a note to the board first'
		select.append(first)
		for (const note of [...list].sort((a, b) => a.title.localeCompare(b.title))) {
			const opt = document.createElement('option')
			opt.value = note.id
			opt.textContent = note.title
			select.append(opt)
		}
		select.addEventListener('change', () => {
			if (!select.value) return
			void face.ctx.updatePayload({ noteId: select.value }).catch(saveFailed)
		})
		// Board shortcuts stay out of the picker's own keys.
		select.addEventListener('keydown', (e) => { e.stopPropagation() })
		label.append(select)
		el.append(label)
	}
}

function dispose(face) {
	if (face.ro) face.ro.disconnect()
	face.ro = null
	face.svg = null
	face.note = null
}

function ensureCSS() {
	if (document.getElementById(CSS_ID)) return
	const style = document.createElement('style')
	style.id = CSS_ID
	style.textContent = globalCSS
	document.head.append(style)
}

// headingsMarkdown -- the note's first line as the root heading and
// every heading after it one level deeper, so the engine nests them
// by level under the note's own name; body text is not part of the
// map, and headings inside fenced code are code, not headings.
// Angle brackets and ampersands are escaped first: a note is the
// user's text, never markup for the face.
function headingsMarkdown(note) {
	const lines = String(note.payload.text || '').split(/\r?\n/)
	const out = ['# ' + inline(note.title || lines[0] || 'Untitled note')]
	let fenced = false
	for (const line of lines.slice(1)) {
		const t = line.trimStart()
		if (/^(```|~~~)/.test(t)) { fenced = !fenced; continue }
		if (fenced) continue
		const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(t)
		if (!m || !m[2]) continue
		out.push('#'.repeat(Math.min(m[1].length + 1, 6)) + ' ' + inline(m[2]))
	}
	return out.join('\n')
}

function inline(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}
