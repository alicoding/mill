// @ts-check
/// <reference path="../../../frontend/plugin-sdk/index.d.ts" />

// Interop provider -- half of the extension-interop reference pair
// (docs/goals/0364). It contributes no canvas object or view: its
// only job is EXPORTING one method (manifest "exports": ["greet"]) for
// mill-interop-consumer to reach through api.extensions.get(id) -- the
// declared-dependency, callee-gated door that replaces reaching into
// another extension's internals (Obsidian's confirmed anti-pattern).
// No build step; no canvas object means this activates inside its own
// sandboxed frame (docs/goals/0375 S1b), the same as any other non-
// built-in extension.

/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	void api
	return {
		greet(name) {
			return `Hello, ${name}! (from mill-interop-provider)`
		},
	}
}
