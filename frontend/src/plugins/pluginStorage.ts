import type { PluginStorageAPI } from './sdk'

// PluginStorageDoors is buildPluginStorage's own door pair (the same
// "takes the door itself" shape pluginFetchJSON.ts's buildFetchJSON
// already uses): a same-DOM plugin's storage persists straight through
// SettingsService (hostApi.ts, plugins/activation.ts's own snapshot
// decode both wire that door), while a framed activation's storage
// persists over its postMessage 'call' -- the SAME cache/validate/
// list-transform logic either way, so this module carries zero
// Mill-app import (no generated bindings) and is safe to bundle
// wholesale into the frame runtime's own build (frontend/src/
// plugin-frame/activation.ts, goal 0396). literal is JSON.stringify(value),
// handed alongside value so a door that only needs the wire string
// (SettingsService's own signature) never has to re-derive it.
export interface PluginStorageDoors {
	set: (key: string, value: unknown, literal: string) => Promise<void>
	delete: (key: string) => Promise<void>
}

// buildPluginStorage -- one plugin's api.storage (goal 0277): a cache
// seeded from the central blob's snapshot for this plugin (the loader
// fetches the whole blob once before any activate()), synchronous
// reads, write-through persistence. Values cross the boundary as JSON
// literals (settingsservice_pluginstorage.go's own contract); a value
// that cannot be serialised (undefined, a function, a cycle) throws at
// the door rather than storing something unreadable.
export function buildPluginStorage(pluginId: string, snapshot: Record<string, string>, doors: PluginStorageDoors): PluginStorageAPI {
	const cache = new Map<string, unknown>()
	for (const [k, literal] of Object.entries(snapshot)) {
		try {
			cache.set(k, JSON.parse(literal))
		} catch {
			// An unreadable stored literal is treated as absent.
		}
	}
	const set = async (key: string, value: unknown) => {
		const literal = JSON.stringify(value)
		if (literal === undefined || literal === 'null') throw new Error(`plugin ${pluginId}: storage value for "${key}" must be JSON-serialisable and not null`)
		cache.set(key, JSON.parse(literal))
		await doors.set(key, value, literal)
	}
	return Object.freeze({
		get: (key: string) => cache.get(key),
		keys: () => [...cache.keys()],
		set,
		delete: async (key: string) => {
			cache.delete(key)
			await doors.delete(key)
		},
		// getList/pushList (goal 0386 S1): sugar over get/set for the
		// request-history/cache-list shape every plugin needing one
		// hand-rolled -- dedupe-by-predicate, unshift, trim to max.
		getList: async (key: string) => {
			const v = cache.get(key)
			return Array.isArray(v) ? [...v] : []
		},
		pushList: async (key: string, item: unknown, opts?: { dedupeBy?: (item: unknown) => unknown; max?: number }) => {
			const current = cache.get(key)
			let list = Array.isArray(current) ? [...current] : []
			if (opts?.dedupeBy) {
				const itemKey = opts.dedupeBy(item)
				list = list.filter((x) => opts.dedupeBy!(x) !== itemKey)
			}
			list.unshift(item)
			if (typeof opts?.max === 'number') list = list.slice(0, opts.max)
			await set(key, list)
		},
	})
}
