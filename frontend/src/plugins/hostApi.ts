import { registerThirdPartyNoun } from '../atlas/atlasNounRegistry'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { useUISignalStore } from '../shared/uiSignalStore'
import type { AtlasArmRequestTool } from '../shared/atlasToolIdentity'
import { collectPluginCommand } from './pluginCommands'
import { buildThirdPartyNoun, seedStyleValues } from './canvasToolAdapter'
import { settingDeclsFromManifest } from './pluginSettings'
import { resolveExtensionSetting, subscribeExtensionSetting } from '../shared/extensionSettingsStore'
import type { CanvasObjectDecl, MillPluginAPI } from './sdk'

// buildPluginAPI constructs the ONE object a plugin ever holds
// (docs/adr/0047 §2: capabilities arrive as api calls the host
// mediates, never as importable primitives). Frozen so a plugin
// cannot re-point a sibling's callbacks. Validation here is the
// host-side twin of pluginsvc's manifest validation: registration
// inputs are checked at the door, with the plugin's own id in every
// error so a broken plugin names itself.
const KIND_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const SOURCES = new Set(['board-local', 'url', 'file'])
const EDIT_ROUTES = new Set(['inline', 'external-app', 'none'])

export function buildPluginAPI(manifest: Manifest, millVersion: string): MillPluginAPI {
	const pluginId = manifest.id
	const requestGuardedAction = async (kind: string, attributes: Record<string, string>, description: string) => {
		const d = await PluginService.RequestGuardedAction(pluginId, kind, attributes, description)
		return { approved: d.Approved, effect: d.Effect, ruleLabel: d.RuleLabel, performed: d.Performed }
	}
	// The settings door (goal 0258 slice 1): declarations come from the
	// validated manifest, values from the same central store the
	// Settings row writes -- one resolver for built-ins and plugins.
	const settingDecls = settingDeclsFromManifest(manifest)
	const declFor = (key: string) => {
		const decl = settingDecls.find((d) => d.key === key)
		if (!decl) throw new Error(`plugin ${pluginId}: setting "${key}" is not declared in the manifest's contributes.settings`)
		return decl
	}
	const settings = Object.freeze({
		get: (key: string) => resolveExtensionSetting(pluginId, declFor(key)),
		onChange: (key: string, fn: (value: boolean | string | number) => void) => subscribeExtensionSetting(pluginId, declFor(key), fn),
	})
	return Object.freeze({
		millVersion,
		pluginId,
		settings,
		registerCanvasObject: (decl: CanvasObjectDecl) => {
			if (!KIND_PATTERN.test(decl.kind)) throw new Error(`plugin ${pluginId}: canvas object kind "${decl.kind}" must be a lowercase slug`)
			if (!SOURCES.has(decl.source)) throw new Error(`plugin ${pluginId}: unknown source "${decl.source}"`)
			if (!EDIT_ROUTES.has(decl.editRoute)) throw new Error(`plugin ${pluginId}: unknown editRoute "${decl.editRoute}"`)
			registerThirdPartyNoun(buildThirdPartyNoun(pluginId, manifest, decl))
			seedStyleValues(decl.kind, decl.styleFields ?? [])
			// The palette parity built-in tools already have (their
			// atlas.create.<id> commands, shared/atlasCreateCommands.ts):
			// a plugin's tool gets the same registry command through the
			// same collector its own commands ride, arming the identical
			// placement mechanism the tray click uses. Enablement is
			// structural -- a disabled plugin never activates, so its
			// command is never collected.
			collectPluginCommand({
				id: `atlas.create.${decl.kind}`,
				label: decl.label,
				surface: ['atlas'],
				// The arm signal's type is the built-in literal union; the
				// runtime gate already accepts any registered third-party
				// id (useAtlasCreation's isThirdPartyToolId OR) -- the
				// same one-documented-cast convention
				// orderedRegisteredTools carries for the registry itself.
				run: () => useUISignalStore.getState().requestAtlasArmTool(decl.kind as AtlasArmRequestTool),
			})
		},
		registerCommand: (decl) => {
			collectPluginCommand({ id: `plugin.${pluginId}.${decl.id}`, label: decl.label, enabled: decl.enabled, run: decl.run })
		},
		requestGuardedAction,
	})
}
