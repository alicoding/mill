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
// contributes.views[].entry, with no plugin code involved -- this
// file needs no activate() call at all.

/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	void api
}
