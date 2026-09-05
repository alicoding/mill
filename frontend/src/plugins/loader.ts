import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { SettingsService } from '../shared/bindings'
import { refreshExtensionSettings } from '../shared/extensionSettingsStore'
import { refreshSecretTitles } from '../shared/secretTitleCache'
import { buildPluginAPI, collectFrameSurfaces } from './hostApi'
import type { MillPluginAPI, PluginModule } from './sdk'
import { pluginRunState, type PluginRunPolicy } from './pluginTrust'
import { collectPluginCommand } from './pluginCommands'

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

// readPluginPolicy reads the four trust inputs pluginRunState judges.
// An unreadable disabled set loads everything -- matching how built-in
// extensions already behave when the same read fails; an unreadable
// allowed set or allow-list fails the same open way (the row then says
// what it could not read, never a silent block). A reload re-reads it
// rather than trusting the boot-time answer: consent granted since
// boot must count, and consent revoked since boot must bite.
export async function readPluginPolicy(): Promise<PluginRunPolicy> {
	return {
		disabled: await readIDs(() => SettingsService.GetDisabledExtensions()),
		allowed: await readIDs(() => SettingsService.GetAllowedPlugins()),
		allowlist: await readIDs(() => SettingsService.GetPluginAllowlist()),
		lock: await readLock(),
	}
}

async function readIDs(read: () => Promise<string[] | null | undefined>): Promise<string[]> {
	try {
		return (await read()) ?? []
	} catch {
		return []
	}
}

export function resolveActivate(mod: PluginModule): ((api: MillPluginAPI) => void | Promise<void>) | null {
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
export async function loadPluginStorage(): Promise<Record<string, Record<string, string>>> {
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

// collectReloadCommand registers the host's own per-plugin reload
// (goal 0319) as an ordinary registry command, one per scanned plugin,
// shaped the way every id-bearing command in this codebase is
// (atlas.create.<kind>, view.open.<plugin>.<view>) -- Command.run takes
// no arguments, so the id IS the argument. It rides the plugin's own
// collector, which means the reload sweep drops it with everything
// else and this call puts it back.
//
// The module is imported lazily inside run() for the loader's own
// import discipline: reloading pulls in the whole activation path, and
// nothing here may widen this module's static graph.
export function collectReloadCommand(info: PluginInfo): void {
	const id = info.Manifest.id
	collectPluginCommand({
		id: `plugin.reload.${id}`,
		label: `Reload ${info.Manifest.name || id}`,
		pluginId: id,
		// Enabled wherever a reload could actually change something: a
		// loaded plugin (the author's dev loop), one that failed (the
		// retry after fixing the file that broke it), and one the row
		// is asking the user to act on -- "Allowed. Reload to load
		// it." and "Turned off. Turn on and reload to load it." both
		// name this button. Blocked/unsigned are the administrator's
		// answer, which no reload can move.
		enabled: () => {
			const status = loadStates.get(id)?.status
			return status !== undefined && status !== 'blocked' && status !== 'unsigned'
		},
		// reloadPluginWithNotice itself never rejects (it reports the
		// reload's own outcome as a notice) -- what CAN still reject is
		// the dynamic import() failing to load the module at all, which
		// runCommand (shared/commands.ts) now catches and reports.
		run: () => import('./pluginReload').then((m) => m.reloadPluginWithNotice(id, info.Manifest.name || id)),
	})
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
	const policy = await readPluginPolicy()
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
		// Registered for every plugin whose manifest parsed, not only the
		// ones that run: the row's reload button is how a user acts on
		// "Allowed. Reload to load it." A folder whose manifest is
		// unreadable never gets here -- it has no id to name.
		collectReloadCommand(info)
		const state = pluginRunState(id, !!info.Builtin, policy, { contentHash: info.ContentHash ?? '', signingPolicy: !!info.SigningPolicy, signed: !!info.Signed })
		if (state !== 'run') {
			loadStates.set(id, { status: state, info })
			continue
		}
		// Framed views and captures are declared, not registered: they
		// are collected before activation so a plugin whose main.js
		// throws still opens the pages its manifest promised.
		collectFrameSurfaces(info.Manifest)
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
