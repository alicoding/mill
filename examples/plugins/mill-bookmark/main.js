// @ts-check
/// <reference path="../../../frontend/plugin-sdk/index.d.ts" />

// Bookmark -- Mill's reference runtime plugin (docs/goals/0249).
// Plain ESM, no build step: copy this folder into the app's plugins
// directory (Settings > Extensions > Open plugins folder) and reload.
//
// It contributes one canvas object on the object contract: a web
// address pinned to the board (source: url). Its face is its own entry
// page (face.html/face.js, docs/goals/0380 S2) -- this file only
// declares the object and its context-menu item, never draws into
// Mill's own document. Open never touches the browser itself -- it
// asks Mill for the guarded open-url action, which the owner's
// guardrail rules evaluate per use.

/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	// The guarded open, shared by the face's own Open button (over the
	// requestGuardedAction door) and this object-menu item: Mill
	// performs the open on approval; the plugin never touches the
	// browser.
	const openGuarded = async (ctx, onStatus) => {
		const url = withScheme((ctx.object.Payload.url || '').trim())
		if (!url) { onStatus('Enter an address first.'); return }
		onStatus('Asking…')
		try {
			const result = await ctx.requestGuardedAction('open-url', { url }, `Open ${url} in the browser`)
			onStatus(result.approved ? 'Opened.' : 'Not allowed' + (result.ruleLabel ? ` (${result.ruleLabel}).` : '.'))
		} catch (err) {
			onStatus(String(err && err.message ? err.message : err))
		}
	}

	api.registerCanvasObject({
		kind: 'bookmark',
		// Context-menu items on bookmark objects only (goal 0280); the
		// open needs an address, so the item hides until there is one.
		menuItems: [
			{
				id: 'open',
				label: 'Open in browser',
				enabled: (ctx) => !!(ctx.object.Payload.url || '').trim(),
				run: (ctx) => { void openGuarded(ctx, (text) => { if (text !== 'Asking…' && text !== 'Opened.') api.notify({ level: 'warning', text }) }) },
			},
		],
		label: 'Bookmark',
		description: 'A web address pinned to the board.',
		icon: '🔖',
		source: 'url',
		editRoute: 'inline',
		defaultPayload: { url: '', title: '' },
		// No renderFace: the manifest's own entry page (face.html) draws
		// it in its own sandboxed frame instead.
	})
}

function withScheme(url) {
	if (!url) return url
	return /^https?:\/\//.test(url) ? url : 'https://' + url
}
