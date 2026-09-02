import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { SettingsService } from '../shared/bindings'
import { refreshExtensionSettings } from '../shared/extensionSettingsStore'
import { buildPluginAPI } from './hostApi'
import type { MillPluginAPI, PluginModule } from './sdk'

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

export type PluginLoadStatus = 'loaded' | 'disabled' | 'error'

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

function resolveActivate(mod: PluginModule): ((api: MillPluginAPI) => void | Promise<void>) | null {
	if (typeof mod.activate === 'function') return mod.activate
	if (typeof mod.default === 'function') return mod.default
	if (mod.default && typeof mod.default.activate === 'function') return mod.default.activate.bind(mod.default)
	return null
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
	let disabled: string[] = []
	try {
		disabled = (await SettingsService.GetDisabledExtensions()) ?? []
	} catch {
		// An unreadable disabled set loads everything -- matching how
		// built-in extensions already behave when the same read fails.
	}
	// Stored setting values load BEFORE any activate() runs, so a plugin
	// reading api.settings.get() at activation sees the user's value,
	// not the default (the store's own refresh path; App's boot effect
	// refetches again later, harmlessly).
	await refreshExtensionSettings()
	for (const info of plugins) {
		const id = info.Manifest.id
		if (info.Error) {
			loadStates.set(id, { status: 'error', error: info.Error, info })
			continue
		}
		if (disabled.includes(id)) {
			loadStates.set(id, { status: 'disabled', info })
			continue
		}
		try {
			const url = `/plugins/${id}/main.js?v=${encodeURIComponent(info.Manifest.version)}`
			const mod = (await import(/* @vite-ignore */ url)) as PluginModule
			const activate = resolveActivate(mod)
			if (!activate) throw new Error('main.js exports no activate() function')
			await Promise.resolve(activate(buildPluginAPI(info.Manifest, millVersion)))
			loadStates.set(id, { status: 'loaded', info })
		} catch (err) {
			loadStates.set(id, { status: 'error', error: err instanceof Error ? err.message : String(err), info })
		}
	}
}
