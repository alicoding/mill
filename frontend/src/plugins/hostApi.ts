import { registerThirdPartyNoun } from '../atlas/atlasNounRegistry'
import { Events } from '@wailsio/runtime'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import { AtlasService } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc'
import { contentEntryFromWire } from './pluginQuery'
import { collectPluginView } from './pluginViews'
import { collectPluginCapture } from './pluginCaptures'
import { SettingsService } from '../shared/bindings'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { useUISignalStore } from '../shared/uiSignalStore'
import type { AtlasArmRequestTool } from '../shared/atlasToolIdentity'
import { collectPluginCommand } from './pluginCommands'
import { buildThirdPartyNoun, seedStyleValues } from './canvasToolAdapter'
import { settingDeclsFromManifest } from './pluginSettings'
import { secretTitleOf } from '../shared/secretTitleCache'
import { buildPluginStorage } from './pluginStorage'
import { pushNotice } from '../shared/noticeStore'
import { resolveExtensionSetting, subscribeExtensionSetting } from '../shared/extensionSettingsStore'
import type { CanvasObjectDecl, ContentQuery, MillPluginAPI, PluginFetchInit } from './sdk'

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

type ContentWriteWire = Parameters<typeof PluginService.WriteContentForPlugin>[1]

async function writeContent(pluginId: string, req: Partial<ContentWriteWire>) {
	const r = await PluginService.WriteContentForPlugin(pluginId, {
		op: '', text: '', title: '', note: '', kindId: '', cardId: '', parentId: '', listId: '', fields: {}, values: {}, position: null, description: '', columns: [], rows: [],
		...req,
	} as ContentWriteWire)
	return { approved: r.approved, effect: r.effect, ruleLabel: r.ruleLabel, id: r.id }
}

export function buildPluginAPI(manifest: Manifest, millVersion: string, storageSnapshot: Record<string, string> = {}): MillPluginAPI {
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
		get: (key: string) => {
			const decl = declFor(key)
			const value = resolveExtensionSetting(pluginId, decl)
			// A secretRef answers the entry's title, never its value or id.
			return decl.type === 'secretRef' ? secretTitleOf(String(value)) : value
		},
		onChange: (key: string, fn: (value: boolean | string | number) => void) => subscribeExtensionSetting(pluginId, declFor(key), fn),
	})
	// The notice door (goal 0277): the plugin's display name is the
	// notice's source; an action must be one of the plugin's OWN
	// registered commands, namespaced exactly as registerCommand did.
	const notify = (input: { text: string; level?: 'info' | 'success' | 'warning' | 'error'; action?: { label: string; commandId: string } }) => {
		if (typeof input?.text !== 'string' || input.text.trim() === '') throw new Error(`plugin ${pluginId}: notify needs a non-empty text`)
		return pushNotice({
			text: input.text,
			level: input.level,
			source: manifest.name || pluginId,
			actions: input.action ? [{ label: input.action.label, commandId: `plugin.${pluginId}.${input.action.commandId}` }] : undefined,
		})
	}
	return Object.freeze({
		millVersion,
		pluginId,
		settings,
		notify,
		storage: buildPluginStorage(pluginId, storageSnapshot),
		// The read doors (goal 0278): query is the bound content index
		// (the same Go index the MCP atlas_list_contents tool reads);
		// on('contents:changed') is the existing 'atlas' dataevent every
		// card/note/object mutation already emits.
		query: async (q: ContentQuery = {}) => ((await AtlasService.ListContents(q.kind ?? '', q.parentId ?? '')) ?? []).map(contentEntryFromWire),
		// The network door (goal 0288): the bound call does every check --
		// capability, declared host + method, guardrail -- and executes
		// host-side; this is only the shape adapter.
		fetch: async (url: string, init: PluginFetchInit = {}) => {
			const r = await PluginService.FetchForPlugin(pluginId, {
				method: init.method ?? 'GET', url, headers: init.headers ?? {}, body: init.body ?? '',
				secret: init.secret ? { settingKey: init.secret.settingKey, header: init.secret.header ?? '', prefix: init.secret.prefix ?? '' } : null,
			})
			const headers: Record<string, string> = {}
			for (const [k, v] of Object.entries(r.headers ?? {})) if (v !== undefined) headers[k] = v
			return { approved: r.approved, effect: r.effect, ruleLabel: r.ruleLabel, status: r.status, headers, body: r.body }
		},
		// The content-write door (goal 0289): every check and the write
		// itself live host-side (WriteContentForPlugin); these are shape
		// adapters over one bound call.
		content: Object.freeze({
			createNote: (input) => writeContent(pluginId, { op: 'note', text: input.text, parentId: input.parentId ?? '', position: input.position ? { X: input.position.x, Y: input.position.y } : null }),
			createCard: (input) => writeContent(pluginId, { op: 'card', kindId: input.kindId, title: input.title, note: input.note ?? '', fields: input.fields ?? {}, parentId: input.parentId ?? '' }),
			updateCard: (id, patch) => writeContent(pluginId, { op: 'card-update', cardId: id, title: patch.title ?? '', note: patch.note ?? '', fields: patch.fields ?? {} }),
			appendListRow: (listId, values) => writeContent(pluginId, { op: 'list-row', listId, values }),
			createList: (input) => writeContent(pluginId, { op: 'list', title: input.title, description: input.description ?? '', columns: input.columns.map((c) => ({ name: c.name, type: c.type ?? '' })), rows: input.rows ?? [] }),
		}),
		// The files door (goal 0310): a folder listing through Mill's
		// read-class evaluation, never the plugin's own filesystem.
		files: Object.freeze({
			list: async (path: string) => {
				const r = await PluginService.ListDirForPlugin(pluginId, path)
				return { approved: r.approved, effect: r.effect, ruleLabel: r.ruleLabel, entries: (r.entries ?? []).map((e) => ({ name: e.name, path: e.path, isDir: e.isDir, size: e.size })) }
			},
		}),
		// The convert door (goal 0282): the shared HTML-to-Markdown
		// converter as a pure transform over one bound call.
		convert: Object.freeze({
			htmlToMarkdown: (html: string) => PluginService.ConvertHTMLToMarkdown(html),
		}),
		on: (event, handler) => {
			if (event !== 'contents:changed') throw new Error(`plugin ${pluginId}: unknown event "${String(event)}"`)
			return Events.On('mill-data-changed', (evt) => {
				const data = evt.data as { entity?: string; id?: string } | undefined
				if (data?.entity === 'atlas') handler({ id: data.id ?? '' })
			})
		},
		registerCanvasObject: (decl: CanvasObjectDecl) => {
			if (!KIND_PATTERN.test(decl.kind)) throw new Error(`plugin ${pluginId}: canvas object kind "${decl.kind}" must be a lowercase slug`)
			if (!SOURCES.has(decl.source)) throw new Error(`plugin ${pluginId}: unknown source "${decl.source}"`)
			if (typeof decl.editRoute !== 'function' && !EDIT_ROUTES.has(decl.editRoute)) throw new Error(`plugin ${pluginId}: unknown editRoute "${decl.editRoute}"`)
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
				pluginId,
				surface: ['atlas'],
				// The arm signal's type is the built-in literal union; the
				// runtime gate already accepts any registered third-party
				// id (useAtlasCreation's isThirdPartyToolId OR) -- the
				// same one-documented-cast convention
				// orderedRegisteredTools carries for the registry itself.
				run: () => useUISignalStore.getState().requestAtlasArmTool(decl.kind as AtlasArmRequestTool),
			})
		},
		// A plugin view (goal 0290): declared in the manifest, registered
		// here with its render, opened by a registry command. The store is
		// imported lazily inside run() -- at activation time the app module
		// graph must not be pulled forward (loader.ts's import discipline).
		registerView: (decl) => {
			const declared = (manifest.contributes?.views ?? []).find((v) => v.id === decl.id)
			if (!declared) throw new Error(`plugin ${pluginId}: view "${decl.id}" is not declared in the manifest's contributes.views`)
			if (typeof decl.render !== 'function') throw new Error(`plugin ${pluginId}: view "${decl.id}" needs a render function`)
			collectPluginView({ pluginId, pluginName: manifest.name || pluginId, viewId: decl.id, title: declared.title, render: decl.render })
			collectPluginCommand({
				id: `view.open.${pluginId}.${decl.id}`,
				label: declared.title,
				pluginId,
				run: () => {
					void import('../shared/store').then((m) => m.useAppStore.getState().openWorkTab({ kind: 'plugin-view', pluginId, viewId: decl.id }))
				},
			})
		},
		// registerCapture (goal 0309): declare-first like views; the face
		// is kept here for the capture window, and a palette command
		// summons that window on it.
		registerCapture: (decl) => {
			const declared = (manifest.contributes?.captures ?? []).find((c) => c.id === decl.id)
			if (!declared) throw new Error(`plugin ${pluginId}: capture "${decl.id}" is not declared in the manifest's contributes.captures`)
			if (typeof decl.render !== 'function') throw new Error(`plugin ${pluginId}: capture "${decl.id}" needs a render function`)
			collectPluginCapture({ pluginId, pluginName: manifest.name || pluginId, captureId: decl.id, label: declared.label, render: decl.render })
			collectPluginCommand({
				id: `capture.${pluginId}.${decl.id}`,
				label: declared.label,
				pluginId,
				run: () => { void SettingsService.ShowCapture(pluginId, decl.id) },
			})
		},
		registerCommand: (decl) => {
			collectPluginCommand({ id: `plugin.${pluginId}.${decl.id}`, label: decl.label, pluginId, enabled: decl.enabled, run: decl.run })
		},
		requestGuardedAction,
	})
}
