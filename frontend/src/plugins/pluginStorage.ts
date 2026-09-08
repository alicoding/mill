import { SettingsService } from '../shared/bindings'
import type { PluginStorageAPI } from './sdk'

// buildPluginStorage -- one plugin's api.storage (goal 0277): a cache
// seeded from the central blob's snapshot for this plugin (the loader
// fetches the whole blob once before any activate()), synchronous
// reads, write-through persistence. Values cross the boundary as JSON
// literals (settingsservice_pluginstorage.go's own contract); a value
// that cannot be serialised (undefined, a function, a cycle) throws at
// the door rather than storing something unreadable.
export function buildPluginStorage(pluginId: string, snapshot: Record<string, string>): PluginStorageAPI {
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
		await SettingsService.SetPluginStorageValue(pluginId, key, literal)
	}
	return Object.freeze({
		get: (key: string) => cache.get(key),
		keys: () => [...cache.keys()],
		set,
		delete: async (key: string) => {
			cache.delete(key)
			await SettingsService.DeletePluginStorageValue(pluginId, key)
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
