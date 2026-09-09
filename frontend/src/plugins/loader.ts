import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { SettingsService } from '../shared/bindings'
import { refreshExtensionSettings } from '../shared/extensionSettingsStore'
import { refreshSecretTitles } from '../shared/secretTitleCache'
import { buildPluginAPI, collectFrameSurfaces } from './hostApi'
import type { MillPluginAPI, PluginExports, PluginModule } from './sdk'
import { pluginRunState, type PluginRunPolicy } from './pluginTrust'
import { collectPluginCommand } from './pluginCommands'
import { activateFramed, isFramedActivation } from './activation'
import { captureSameDomExports } from './extensionExports'

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
// administrator's allow-list. 'waits' (goal 0364): the plugin itself
// passed every trust gate, but a manifest-declared dependency never
// reached 'loaded' (not installed, disabled, or itself waiting) --
// activation never runs, so the row names what it is waiting for
// (waitsFor) rather than a reason it could fix by itself. None of
// these run any plugin code.
export type PluginLoadStatus = 'loaded' | 'policy' | 'disabled' | 'unallowed' | 'blocked' | 'unsigned' | 'changed' | 'error' | 'waits'

export interface PluginLoadState {
	status: PluginLoadStatus
	error?: string
	info: PluginInfo
	// The dependency id this plugin is waiting on, set only when status
	// is 'waits'.
	waitsFor?: string
}

const loadStates = new Map<string, PluginLoadState>()

// pluginLoadStates -- the Extensions section's join source: every
// scanned plugin folder with what actually happened to it this boot.
export function pluginLoadStates(): Map<string, PluginLoadState> {
	return loadStates
}

// pluginsAwaitingReview counts the plugins installed but not yet
// allowed to run -- the boot notice's number.
// pluginDisplayName -- the plugin's own manifest name, for any surface
// that must say WHERE a contribution came from (the creation dock's
// More panel, goal 0355). A manifest id is developer vocabulary, so it
// is the fallback only, never the first answer.
export function pluginDisplayName(id: string): string {
	return loadStates.get(id)?.info.Manifest.name || id
}

// A plugin needs a decision in 'unallowed' (never reviewed, or widened
// past its consent -- pluginTrust.ts folds 'widened' into this same
// status) and 'changed' (files edited since it was allowed). Every
// consumer -- the boot notice, the nav badge, the installed list's
// pinned group -- reads pluginsAwaitingReview()/pluginsAwaitingReviewIds()
// rather than re-deriving the state set, so they can never disagree.
function needsReview(status: PluginLoadStatus): boolean {
	return status === 'unallowed' || status === 'changed'
}

// states defaults to the boot scan's own map; a test passes a synthetic
// one rather than driving a real plugin load.
export function pluginsAwaitingReview(states: ReadonlyMap<string, PluginLoadState> = loadStates): number {
	let n = 0
	for (const s of states.values()) if (needsReview(s.status)) n++
	return n
}

// pluginsAwaitingReviewIds -- the same set, by id: the notice's deep
// link reads this to decide whether exactly one plugin waits (select
// it) or several do (open the list with its pinned group).
export function pluginsAwaitingReviewIds(states: ReadonlyMap<string, PluginLoadState> = loadStates): string[] {
	const ids: string[] = []
	for (const [id, s] of states) if (needsReview(s.status)) ids.push(id)
	return ids
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

export function resolveActivate(mod: PluginModule): ((api: MillPluginAPI) => PluginExports | Promise<PluginExports>) | null {
	if (typeof mod.activate === 'function') return mod.activate
	if (typeof mod.default === 'function') return mod.default
	if (mod.default && typeof mod.default.activate === 'function') return mod.default.activate.bind(mod.default)
	return null
}

// DataOnly comes from the backend's validated manifest classification. This
// small predicate keeps the activation boundary explicit and directly tested:
// only that authoritative flag can bypass loading main.js.
export function pluginNeedsActivation(info: Pick<PluginInfo, 'DataOnly'>): boolean {
	return !info.DataOnly
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
			return status !== undefined && status !== 'blocked' && status !== 'unsigned' && status !== 'policy'
		},
		// reloadPluginWithNotice itself never rejects (it reports the
		// reload's own outcome as a notice) -- what CAN still reject is
		// the dynamic import() failing to load the module at all, which
		// runCommand (shared/commands.ts) now catches and reports.
		run: () => import('./pluginReload').then((m) => m.reloadPluginWithNotice(id, info.Manifest.name || id)),
	})
}

// activateOne runs exactly one plugin's activate(): framed inside a
// sandboxed activation frame, or same-DOM, per isFramedActivation.
// Split out of loadPlugins() so the per-plugin branch reads as one
// step, not nested inside the scan loop's own state machine.
async function activateOne(info: PluginInfo, millVersion: string, storageSnapshot: Record<string, string>): Promise<void> {
	if (isFramedActivation(!!info.Builtin, info.Manifest)) {
		// A framed plugin's export capture happens inside activateFramed
		// itself, at its own activation-done message -- the returned
		// object never leaves that frame's realm.
		await activateFramed(info, millVersion, storageSnapshot)
		return
	}
	const url = `/plugins/${info.Manifest.id}/main.js?v=${encodeURIComponent(info.Manifest.version)}`
	const mod = (await import(/* @vite-ignore */ url)) as PluginModule
	const activate = resolveActivate(mod)
	if (!activate) throw new Error('main.js exports no activate() function')
	const returned = await Promise.resolve(activate(buildPluginAPI(info.Manifest, millVersion, storageSnapshot)))
	captureSameDomExports(info.Manifest.id, info.Manifest.exports ?? [], returned)
}

// dependencyOrder answers `plugins` re-ordered so a dependency
// activates before its dependant (a plain DFS topological sort): a
// cycle among installed extensions cannot happen (standard rule 33
// refuses one at install), but a folder dropped in by hand bypasses
// that door, so a cycle here degrades to "already on the walk stack,
// skip" rather than an infinite recursion.
export function dependencyOrder(plugins: PluginInfo[]): PluginInfo[] {
	const byID = new Map(plugins.map((p) => [p.Manifest.id, p]))
	const visited = new Set<string>()
	const visiting = new Set<string>()
	const order: PluginInfo[] = []
	const visit = (p: PluginInfo) => {
		const id = p.Manifest.id
		if (visited.has(id) || visiting.has(id)) return
		visiting.add(id)
		for (const dep of p.Manifest.dependencies ?? []) {
			const depPlugin = byID.get(dep.id)
			if (depPlugin) visit(depPlugin)
		}
		visiting.delete(id)
		visited.add(id)
		order.push(p)
	}
	for (const p of plugins) visit(p)
	return order
}

// unmetDependency answers the first declared dependency that has not
// reached 'loaded' yet -- called only after every dependency in
// info.Manifest.dependencies has ALREADY been processed this boot
// (dependencyOrder guarantees it), so a missing loadStates entry means
// "not installed" exactly as a 'loaded' miss means "disabled, blocked,
// erroring, or itself waiting".
function unmetDependency(info: PluginInfo): string | undefined {
	for (const dep of info.Manifest.dependencies ?? []) {
		if (loadStates.get(dep.id)?.status !== 'loaded') return dep.id
	}
	return undefined
}

async function activateIfNeeded(info: PluginInfo, millVersion: string, storage: Record<string, string>) {
	if (pluginNeedsActivation(info)) await activateOne(info, millVersion, storage)
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
	// A dependency activates before its dependant (goal 0364's design
	// contract item 2): the ONLY reordering the loop below needs,
	// since every other rule (trust gate, then dependency-satisfied
	// check) reads loadStates entries the walk already guarantees are
	// set for everything earlier in this order.
	for (const info of dependencyOrder(plugins)) {
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
		const state = pluginRunState(id, !!info.Builtin, policy, { contentHash: info.CodeHash ?? '', signingPolicy: !!info.SigningPolicy, signed: !!info.Signed, policyBlocked: info.PolicyBlocked ?? '', widened: !!info.Widened })
		if (state !== 'run') {
			loadStates.set(id, { status: state, info })
			continue
		}
		const waitsFor = unmetDependency(info)
		if (waitsFor) {
			loadStates.set(id, { status: 'waits', info, waitsFor })
			continue
		}
		// Framed views and captures are declared, not registered: they
		// are collected before activation so a plugin whose main.js
		// throws still opens the pages its manifest promised.
		collectFrameSurfaces(info.Manifest)
		try {
			await activateIfNeeded(info, millVersion, storage[id] ?? {})
			loadStates.set(id, { status: 'loaded', info })
		} catch (err) {
			loadStates.set(id, { status: 'error', error: err instanceof Error ? err.message : String(err), info })
		}
	}
}
