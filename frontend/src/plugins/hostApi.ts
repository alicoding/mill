import { createElement } from 'react'
import type { Icon } from '@primer/octicons-react'
import { registerThirdPartyNoun } from '../atlas/atlasNounRegistry'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { ingestionClaimMismatch } from './ingestionClaims'
import { useUISignalStore } from '../shared/uiSignalStore'
import type { AtlasArmRequestTool } from '../shared/atlasToolIdentity'
import { collectPluginCommand } from './pluginCommands'
import { pluginFaceComponent } from './PluginFaceContent'
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

// One emoji as the tray/palette icon -- wrapped into the octicon
// component shape the registry's `icon` field expects. The cast is the
// one place the two icon worlds meet; the rendered output honors the
// same size prop octicons do.
function emojiIcon(emoji: string): Icon {
	const Component = ({ size = 16 }: { size?: number | string }) =>
		createElement('span', { style: { fontSize: typeof size === 'number' ? `${size}px` : size, lineHeight: 1 }, 'aria-hidden': true }, emoji)
	return Component as unknown as Icon
}

export function buildPluginAPI(manifest: Manifest, millVersion: string): MillPluginAPI {
	const pluginId = manifest.id
	const requestGuardedAction = async (kind: string, attributes: Record<string, string>, description: string) => {
		const d = await PluginService.RequestGuardedAction(pluginId, kind, attributes, description)
		return { approved: d.Approved, effect: d.Effect, ruleLabel: d.RuleLabel, performed: d.Performed }
	}
	return Object.freeze({
		millVersion,
		pluginId,
		registerCanvasObject: (decl: CanvasObjectDecl) => {
			if (!KIND_PATTERN.test(decl.kind)) throw new Error(`plugin ${pluginId}: canvas object kind "${decl.kind}" must be a lowercase slug`)
			if (!SOURCES.has(decl.source)) throw new Error(`plugin ${pluginId}: unknown source "${decl.source}"`)
			if (!EDIT_ROUTES.has(decl.editRoute)) throw new Error(`plugin ${pluginId}: unknown editRoute "${decl.editRoute}"`)
			if (typeof decl.renderFace !== 'function') throw new Error(`plugin ${pluginId}: renderFace must be a function`)
			const contribution = (manifest.contributes?.canvasObjects ?? []).find((c) => c.kind === decl.kind)
			const claimError = ingestionClaimMismatch(contribution, decl.source)
			if (claimError) throw new Error(`plugin ${pluginId}: ${claimError}`)
			registerThirdPartyNoun({
				id: decl.kind,
				interaction: 'arm-then-click',
				thirdParty: true,
				pluginId,
				defaultPayload: { ...(decl.defaultPayload ?? {}) },
				fileExtensions: (contribution?.fileExtensions ?? []).map((e) => e.toLowerCase()),
				icon: emojiIcon(decl.icon),
				label: decl.label,
				nounName: decl.label,
				description: decl.description,
				shortcutKey: null,
				tray: 'quick',
				group: decl.source === 'file' ? 'file' : 'knowledge',
				styleFields: [],
				lockable: false,
				resizable: true,
				boardNodeType: 'atlas-object',
				dragBand: true,
				fileBacked: decl.source === 'file',
				boardObjectKind: decl.kind,
				content: {
					Component: pluginFaceComponent(pluginId, decl),
					// i18next returns an unknown key verbatim, so the
					// label doubles as the wrapper's accessible name --
					// a plugin has no locale bundle to key into.
					ariaLabelKey: decl.label,
					role: undefined,
					source: decl.source === 'file' ? { kind: 'file', pathKey: 'mirrorPath' } : decl.source === 'url' ? { kind: 'url', urlKey: 'url' } : { kind: 'board-local' },
					editRoute: { kind: decl.editRoute },
				},
				sticky: false,
				gesture: null,
				commit: () => {
					throw new Error('third-party placement goes through useAtlasCreation’s generic branch, never commit()')
				},
			})
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
			collectPluginCommand({ id: `plugin.${pluginId}.${decl.id}`, label: decl.label, run: decl.run })
		},
		requestGuardedAction,
	})
}
