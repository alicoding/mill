// @ts-check
/// <reference path="../../../frontend/plugin-sdk/index.d.ts" />

// Request tester -- Mill's example of a USEFUL extension built only on
// the plugin doors (docs/goals/0291): a work tab, the guarded network
// (api.fetch over an any-host declaration, so every request asks
// first), per-plugin storage (request history), and a declared setting
// (the default method). No build step.
//
// The view's own page (tester.html/tester.js) does everything now
// (docs/goals/0375 S1b): it opens straight from the manifest's own
// contributes.views[].entry, with no plugin code involved.
//
// The view/title seat's worked example (goal 0349 S2b): "Send again"
// is a host-side command (a framed view's own page has no doors but
// postMessage, so the button that seats in the tab header has to live
// here) that re-plays the page's own send button through the SAME
// view handle registerView returns. Its enablement is the manifest's
// own declared when: "plugin.hasResult" (goal 0349 S2c) -- tester.js
// calls mill.call('context.set', 'hasResult', true) once a send has a
// result to replay, and that's what turns this title action on, since
// this plugin activates in its own sandboxed frame and cannot answer
// Command.enabled with a live predicate of its own across the async
// message boundary.
/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	const view = api.registerView({ id: 'tester' })
	api.registerCommand({
		id: 'mill-request-tester.sendAgain',
		label: 'Send again',
		run: () => view.postMessage({ type: 'send-again' }),
	})
}
