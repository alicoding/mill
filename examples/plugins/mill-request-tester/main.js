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
// view handle registerView returns. No enabled predicate: this plugin
// has no canvas object, so it activates in its own sandboxed frame
// (activation.ts's isFramedActivation) -- a framed activation's
// registerCommand answers Command.enabled with a synchronous ctx.alive
// only (pluginActivationBridge.ts), never a plugin-declared predicate,
// since Command.enabled must return synchronously and the plugin's own
// state lives across an async message boundary. Always-available here
// matches what the bridge actually delivers.
/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	const view = api.registerView({ id: 'tester' })
	api.registerCommand({
		id: 'mill-request-tester.sendAgain',
		label: 'Send again',
		run: () => view.postMessage({ type: 'send-again' }),
	})
}
