import i18n from 'i18next'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { SettingsService } from '../shared/bindings'
import { resetLazyArrays } from '../shared/lazySnapshot'
import { unregisterThirdPartyNouns } from '../atlas/atlasNounRegistry'
import { buildPluginAPI } from './hostApi'
import { collectReloadCommand, loadPluginStorage, pluginLoadStates, readPluginPolicy, resolveActivate } from './loader'
import { unregisterPluginCaptures } from './pluginCaptures'
import { unregisterPluginCommands } from './pluginCommands'
import { notifyPluginReloaded } from './pluginReloadSignal'
import { pluginRunState } from './pluginTrust'
import { unregisterPluginViews } from './pluginViews'
import { pushNotice } from '../shared/noticeStore'
import type { PluginModule } from './sdk'

// Per-plugin reload (goal 0319): drop exactly what one plugin
// contributed, import its main.js again, and activate the fresh
// module -- the dev loop the surveyed plugin platforms all ship, in
// place of restarting the whole app.
//
// It is the SAME gate boot runs, never a relaxed one: the policy is
// re-read and pluginRunState judged again, so a folder edited since
// its consent was granted comes back 'changed' and refuses here
// exactly as it would on a restart. That is the point of the content
// lock, and a reload button is precisely where it would be tempting to
// skip it.
//
// What is NOT swept: the plugin's stored values (api.storage is the
// plugin's own data, not a registration) and objects already on the
// board (their Kind resolves to the fallback face for the moment
// between unregister and re-register, which is the same rendering an
// uninstalled plugin's objects already get).

const REFUSAL: Record<string, string> = {
	disabled: 'it is turned off',
	blocked: 'an administrator blocked it',
	unallowed: 'it has not been allowed to run yet',
	unsigned: 'its signature did not verify',
	changed: 'its files changed since you allowed it -- allow it again on its row',
}

function unregisterContributions(pluginId: string): void {
	unregisterPluginCommands(pluginId)
	unregisterPluginViews(pluginId)
	unregisterPluginCaptures(pluginId)
	unregisterThirdPartyNouns(pluginId)
}

// currentInfo re-scans rather than reusing the boot-time record: a
// reload exists to pick up edits, and the manifest is one of the files
// an author edits (a new view, a changed version, a fresh capability).
async function currentInfo(pluginId: string): Promise<PluginInfo> {
	const infos = (await PluginService.ListPlugins()) ?? []
	const info = infos.find((i) => i.Manifest.id === pluginId)
	if (!info) throw new Error('it is no longer installed')
	if (info.Error) throw new Error(info.Error)
	return info
}

// reloadPlugin re-activates one plugin in place. It throws with a
// user-facing reason -- the caller (the Extensions row, the registry
// command) shows it as a notice; nothing here writes to the screen.
export async function reloadPlugin(pluginId: string): Promise<void> {
	const info = await currentInfo(pluginId)
	const policy = await readPluginPolicy()
	const state = pluginRunState(pluginId, !!info.Builtin, policy, {
		contentHash: info.ContentHash ?? '',
		signingPolicy: !!info.SigningPolicy,
		signed: !!info.Signed,
	})
	if (state !== 'run') throw new Error(REFUSAL[state] ?? state)
	let millVersion = ''
	try {
		millVersion = await SettingsService.AppVersion()
	} catch {
		// Version is informational to a plugin; the reload proceeds.
	}
	const storage = await loadPluginStorage()
	// Sweeping drops the host's own reload command with the plugin's
	// contributions (it rides the same collector), so it is put back
	// immediately -- before activation, and again if activation throws:
	// retrying after a broken edit is exactly when the button matters.
	const sweep = () => {
		unregisterContributions(pluginId)
		collectReloadCommand(info)
	}
	sweep()
	try {
		// The query is what makes this a RELOAD: a module already in the
		// browser's registry is never fetched again, so the version alone
		// (unchanged when an author edits main.js in place) would re-run
		// the code that is already loaded.
		const url = `/plugins/${pluginId}/main.js?v=${encodeURIComponent(info.Manifest.version)}&reload=${Date.now()}`
		const mod = (await import(/* @vite-ignore */ url)) as PluginModule
		const activate = resolveActivate(mod)
		if (!activate) throw new Error('main.js exports no activate() function')
		await Promise.resolve(activate(buildPluginAPI(info.Manifest, millVersion, storage[pluginId] ?? {})))
		pluginLoadStates().set(pluginId, { status: 'loaded', info })
	} catch (err) {
		// A half-activated plugin is worse than an unloaded one: whatever
		// it managed to register before throwing is swept back out, and
		// its row says why it is not running.
		sweep()
		pluginLoadStates().set(pluginId, { status: 'error', error: err instanceof Error ? err.message : String(err), info })
		throw err
	} finally {
		resetLazyArrays()
		notifyPluginReloaded()
	}
}

// reloadPluginWithNotice is what the registry command runs, so the
// palette entry and the Extensions row's button report the same
// outcome in the same place -- the button renders the command, it
// never re-implements it.
//
// The i18next instance is imported from the package, not from
// app/i18n.ts: app/ is the only folder allowed to import that module
// (.claude/rules/frontend.md), and this is the same already-
// initialized global every useTranslation() call reads.
export function reloadPluginWithNotice(pluginId: string, name: string): void {
	void reloadPlugin(pluginId)
		.then(() => pushNotice({ text: i18n.t('views:settings.extensions.pluginReloaded', { name }), level: 'success' }))
		.catch((err) => pushNotice({
			text: i18n.t('views:settings.extensions.pluginReloadFailed', { name, error: err instanceof Error ? err.message : String(err) }),
			level: 'error',
		}))
}
