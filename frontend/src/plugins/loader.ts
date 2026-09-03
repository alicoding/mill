import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { SettingsService } from '../shared/bindings'
import { refreshExtensionSettings } from '../shared/extensionSettingsStore'
import { refreshSecretTitles } from '../shared/secretTitleCache'
import { buildPluginAPI } from './hostApi'
import type { MillPluginAPI, PluginModule } from './sdk'
import { pluginRunState } from './pluginTrust'

// The runtime plugin loader (docs/goals/0249). Runs BEFORE the app
// module graph evaluates (main.tsx awaits it and only then
// dynamic-imports App), so every module-eval snapshot downstream --
// the tool list, the palette command table, the Extensions rows --
// already contains plugin registrations, with no late-registration
// machinery anywhere. The cost of that simplicity is honest: a plugin
// installed while Mill is running needs an app reload (the Extensions
// section offers one), the same load-at-start contract the surveyed
// desktop plugin platforms converge on.
//
// IMPORT DISCIPLINE (load-bearing): nothing imported here, directly or
// transitively, may evaluate src/atlas/atlasTools.ts -- that module
// SNAPSHOTS the tool registry at eval, which must happen after
// activation. hostApi -> atlasNounRegistry stays below that line;
// plugin commands go through plugins/pluginCommands.ts's collector for
// the same reason.

// 'unallowed': installed after the run gate and not yet allowed by the
// user (the install-time review, ADR-0051 §4); 'blocked': off the
// administrator's allow-list. Neither runs any plugin code.
export type PluginLoadStatus = 'loaded' | 'disabled' | 'unallowed' | 'blocked' | 'unsigned' | 'changed' | 'error'

export interface PluginLoadState {
	status: PluginLoadStatus
	error?: string
	info: PluginInfo
}

const loadStates = new Map<string, PluginLoadState>()

// pluginLoadStates -- the Extensions section's join source: every
// scanned plugin folder with what actually happened to it this boot.
export function pluginLoadStates(): Map<string, PluginLoadState> {
	return loadStates
}

// pluginsAwaitingReview counts the plugins installed but not yet
// allowed to run -- the boot notice's number.
export function pluginsAwaitingReview(): number {
	let n = 0
	for (const s of loadStates.values()) if (s.status === 'unallowed') n++
	return n
}

// readLock flattens the lock to id -> hash; unreadable means an empty
// lock (nothing revoked), the same fail-open shape as the lists.
async function readLock(): Promise<Record<string, string>> {
	try {
		const raw = (await SettingsService.GetPluginLock()) ?? {}
		const out: Record<string, string> = {}
		for (const [id, entry] of Object.entries(raw)) if (entry?.hash) out[id] = entry.hash
		return out
	} catch {
		return {}
	}
}

async function readIDs(read: () => Promise<string[] | null | undefined>): Promise<string[]> {
	try {
		return (await read()) ?? []
	} catch {
		return []
	}
}

function resolveActivate(mod: PluginModule): ((api: MillPluginAPI) => void | Promise<void>) | null {
	if (typeof mod.activate === 'function') return mod.activate
	if (typeof mod.default === 'function') return mod.default
	if (mod.default && typeof mod.default.activate === 'function') return mod.default.activate.bind(mod.default)
	return null
}

// loadPluginStorage fetches every plugin's stored values in one call
// (goal 0277), BEFORE any activate(), so api.storage.get() is
// synchronous and honest from the first call. An unreadable blob means
// every plugin starts empty. The generated binding types every nested
// value as possibly-absent; this densifies it.
async function loadPluginStorage(): Promise<Record<string, Record<string, string>>> {
	const storage: Record<string, Record<string, string>> = {}
	try {
		const raw = (await SettingsService.GetPluginStorage()) ?? {}
		for (const [plugin, keys] of Object.entries(raw)) {
			if (!keys) continue
			storage[plugin] = {}
			for (const [k, v] of Object.entries(keys)) if (v !== undefined) storage[plugin][k] = v
		}
	} catch {
		return {}
	}
	return storage
}

// loadPlugins scans, filters to enabled+valid, and activates each
// plugin's main.js. Every failure is PER-PLUGIN -- recorded on its own
// row, never thrown upward -- and the whole pass is raced against a
// deadline in main.tsx so a hung import can never brick the boot.
export async function loadPlugins(): Promise<void> {
	let millVersion = ''
	try {
		millVersion = await SettingsService.AppVersion()
	} catch {
		// Version is informational to a plugin; loading proceeds.
	}
	let plugins: PluginInfo[]
	try {
		plugins = (await PluginService.ListPlugins()) ?? []
	} catch (err) {
		console.error('plugin scan failed', err)
		return
	}
	// An unreadable disabled set loads everything -- matching how
	// built-in extensions already behave when the same read fails; an
	// unreadable allowed set or allow-list fails the same open way (the
	// row then says what it could not read, never a silent block).
	const policy = {
		disabled: await readIDs(() => SettingsService.GetDisabledExtensions()),
		allowed: await readIDs(() => SettingsService.GetAllowedPlugins()),
		allowlist: await readIDs(() => SettingsService.GetPluginAllowlist()),
		lock: await readLock(),
	}
	// Stored setting values load BEFORE any activate() runs, so a plugin
	// reading api.settings.get() at activation sees the user's value,
	// not the default (the store's own refresh path; App's boot effect
	// refetches again later, harmlessly).
	await refreshExtensionSettings()
	// Vault titles load the same way, so a secretRef setting's get()
	// answers the title from the first activate() on.
	await refreshSecretTitles()
	const storage = await loadPluginStorage()
	for (const info of plugins) {
		const id = info.Manifest.id
		if (info.Error) {
			loadStates.set(id, { status: 'error', error: info.Error, info })
			continue
		}
		const state = pluginRunState(id, !!info.Builtin, policy, { contentHash: info.ContentHash ?? '', signingPolicy: !!info.SigningPolicy, signed: !!info.Signed })
		if (state !== 'run') {
			loadStates.set(id, { status: state, info })
			continue
		}
		try {
			const url = `/plugins/${id}/main.js?v=${encodeURIComponent(info.Manifest.version)}`
			const mod = (await import(/* @vite-ignore */ url)) as PluginModule
			const activate = resolveActivate(mod)
			if (!activate) throw new Error('main.js exports no activate() function')
			await Promise.resolve(activate(buildPluginAPI(info.Manifest, millVersion, storage[id] ?? {})))
			loadStates.set(id, { status: 'loaded', info })
		} catch (err) {
			loadStates.set(id, { status: 'error', error: err instanceof Error ? err.message : String(err), info })
		}
	}
}
