// The boot-order tripwire (docs/goals/0249): src/atlas/atlasTools.ts
// SNAPSHOTS the tool registry at module eval, which must happen after
// plugin activation in the main window. This module is import-free so
// both sides can reach it without joining each other's graphs.
let settled = false

export function markPluginsSettled(): void {
	settled = true
}

// warnIfSnapshotBeforePlugins -- called by atlasTools.ts at its own
// eval. Only the MAIN window carries the invariant (unit tests import
// the snapshot without ever loading plugins, same as the main window
// before its own boot settles). The early return is scoped to the
// #/settings route alone, not any non-empty hash -- every other hash
// route (main.tsx's aux windows, none of which loads plugins either)
// still trips the tripwire if its snapshot evaluates early.
export function warnIfSnapshotBeforePlugins(): void {
	if (typeof window === 'undefined') return
	if (window.location.hash.startsWith('#/settings')) return
	if (!settled) {
		console.warn('atlasTools evaluated before plugin loading settled: runtime plugins will be missing from the tool list until the app reloads')
	}
}
