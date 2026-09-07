import { createElement, useEffect, useRef } from 'react'
import type { ComponentType } from 'react'
import { ArrowUpRightIcon, CircleIcon, DiamondIcon, PencilIcon, SquareIcon, TrashIcon, ZapIcon, type Icon } from '@primer/octicons-react'
import { AtlasService } from '../shared/bindings'
import { ATLAS_TOOL_IDENTITIES } from '../shared/atlasToolIdentity'
import { refreshAtlas } from '../atlas/atlasStore'
import { frameContainingPoint } from '../atlas/atlasFramePoint'
import { pointHitIDs } from '../atlas/atlasEnclosure'
import type { EditRouteDecl } from '../atlas/objectSeams'
import { useAtlasStyleValues, type AtlasStyleValue } from '../atlas/atlasStyleValueStore'
import type { AtlasStyleField } from '../atlas/atlasStyleVocabulary'
import { thirdPartyNouns, type AtlasGestureCtx, type AtlasGesturePoint, type AtlasToolGesture, type ThirdPartyNounShape } from '../atlas/atlasNounRegistry'
import { meetsDragThreshold } from '../atlas/useAtlasToolGesture'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { ingestionClaimMismatch } from './ingestionClaims'
import { pluginFaceComponent, pluginObjectCtx } from './PluginFaceContent'
import { pluginFramedFaceComponent } from './PluginFaceFrame'
import type { CanvasGestureCtx, CanvasGestureDecl, CanvasObjectDecl, CanvasObjectMenuItem, CanvasStyleFieldDecl } from './sdk'

// The gesture/style half of a plugin's canvas registration (goal 0252
// S1): adapts the SDK's plain-data declarations onto the SAME registry
// fields built-in tools declare, so the tray's drag-to-draw branch,
// AtlasStylePanel, and the one gesture engine all serve a plugin tool
// with zero plugin-aware branches of their own.

// The named glyph set (goal 0252 S2, the codicon convention): a
// no-build plugin names an icon instead of shipping one; the host maps
// the name onto the same icon family built-in tools use. Grows per
// real plugin need, never speculatively.
const NAMED_GLYPHS: Record<string, Icon> = {
	'pencil': PencilIcon,
	'zap': ZapIcon,
	'trash': TrashIcon,
	'diamond': DiamondIcon,
	'square': SquareIcon,
	'circle': CircleIcon,
	'arrow-up-right': ArrowUpRightIcon,
}

// A glyph-shaped string (a lowercase name) either resolves in the
// table or is an error; anything else renders as emoji text.
const GLYPH_NAME_PATTERN = /^[a-z][a-z0-9-]*$/
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

function iconDeclError(value: string, field: string): string | null {
	if (GLYPH_NAME_PATTERN.test(value) && !NAMED_GLYPHS[value]) {
		return `${field} "${value}" is not a known glyph (known: ${Object.keys(NAMED_GLYPHS).join(', ')}). Use one of those or an emoji`
	}
	return null
}

function styleFieldError(f: CanvasStyleFieldDecl): string | null {
	if (!['color', 'color-or-none', 'stroke-width', 'shape-kind'].includes(f.type)) {
		return `unknown style field type "${String((f as { type?: string }).type)}"`
	}
	if (!/^[a-zA-Z][a-zA-Z0-9-]{0,31}$/.test(f.key)) return `style field key "${f.key}" must be a short alphanumeric name`
	if (!Array.isArray(f.options) || f.options.length === 0) return `style field "${f.key}" needs a non-empty options list`
	if (f.type === 'shape-kind') {
		for (const opt of f.options) {
			const iconError = iconDeclError(opt.icon, `style field "${f.key}" option icon`)
			if (iconError) return iconError
		}
	}
	return null
}

// The interaction/gesture/face pairing rules, one concern of
// canvasToolDeclError's below.
function interactionDeclError(decl: CanvasObjectDecl, framed: boolean): string | null {
	const interaction = decl.interaction ?? 'arm-then-click'
	if (!['arm-then-click', 'drag-to-draw', 'ephemeral-drag'].includes(interaction)) {
		return `unknown interaction "${String(decl.interaction)}"`
	}
	const dragShaped = interaction !== 'arm-then-click'
	if (dragShaped && typeof decl.gesture?.onEnd !== 'function') {
		return `interaction "${interaction}" requires a gesture with an onEnd function`
	}
	if (!dragShaped && decl.gesture) {
		return 'a gesture is only legal on a drag interaction ("drag-to-draw" or "ephemeral-drag")'
	}
	if (interaction !== 'ephemeral-drag' && typeof decl.renderFace !== 'function' && !framed) {
		return 'renderFace must be a function, or the manifest must declare an entry page for this kind'
	}
	const menuProblem = menuItemsProblem(decl.menuItems ?? [])
	if (menuProblem) return menuProblem
	if (decl.lockable && (decl.sticky ?? dragShaped)) {
		return 'lockable requires a drag tool with sticky: false (a sticky tool never disarms, so a lock would be meaningless)'
	}
	return null
}

// The identity/appearance field rules (goal 0252 S2's doors).
function identityDeclError(decl: CanvasObjectDecl): string | null {
	if (decl.objectKind !== undefined && !SLUG_PATTERN.test(decl.objectKind)) {
		return `objectKind "${decl.objectKind}" must be a lowercase slug`
	}
	if (decl.shortcutKey !== undefined && !/^[A-Z]$/.test(decl.shortcutKey)) {
		return `shortcutKey "${decl.shortcutKey}" must be a single A-Z letter`
	}
	if (decl.group !== undefined && !['objects', 'media', 'annotate', 'embed'].includes(decl.group)) {
		return `unknown group "${String(decl.group)}"`
	}
	return iconDeclError(decl.icon, 'icon')
}

// Registration-time validation, split out pure so a unit test can
// drive every refusal without touching the live registry. Returns an
// error string (with no plugin prefix -- the caller adds it) or null.
export function canvasToolDeclError(decl: CanvasObjectDecl, framed = false): string | null {
	const pairingError = interactionDeclError(decl, framed) ?? identityDeclError(decl)
	if (pairingError) return pairingError
	for (const f of decl.styleFields ?? []) {
		const fieldError = styleFieldError(f)
		if (fieldError) return fieldError
	}
	return null
}

// styleFieldDefault -- what a field's value starts at (the
// color-or-none vocabulary pins 'none' as that type's default).
export function styleFieldDefault(f: CanvasStyleFieldDecl): AtlasStyleValue {
	return f.type === 'color-or-none' ? 'none' : f.default
}

// adaptStyleFields fills the panel's own accessibility/test plumbing
// the SDK deliberately doesn't expose: testids derive from the tool id
// + field key, labels render VERBATIM through i18next's missing-key
// fallback (a plugin has no locale bundle -- the same convention
// hostApi's ariaLabelKey already uses), and stroke-width option labels
// reuse the existing generic "{{size}}px"/"{{width}}px" strings so
// screen readers get real interpolated values.
export function adaptStyleFields(kind: string, label: string, fields: readonly CanvasStyleFieldDecl[]): AtlasStyleField[] {
	return fields.map((f): AtlasStyleField => {
		const base = { key: f.key, testidPrefix: `atlas-${kind}-${f.key}`, groupLabelKey: f.label ?? `${label} ${f.key}` }
		switch (f.type) {
			case 'color':
				return { ...base, type: 'color', options: f.options, default: f.default }
			case 'color-or-none':
				return { ...base, type: 'color-or-none', options: f.options, noneLabelKey: 'None', default: 'none' }
			case 'stroke-width': {
				const render = f.render ?? 'dot'
				return { ...base, type: 'stroke-width', render, options: f.options, optionLabelKey: render === 'dot' ? 'pencilStyle.sizeOption' : 'shapeStyle.widthOption', default: f.default }
			}
			case 'shape-kind':
				return {
					...base,
					type: 'shape-kind',
					options: f.options.map((opt) => ({ value: opt.value, Icon: NAMED_GLYPHS[opt.icon] ?? emojiIcon(opt.icon), labelKey: opt.label })),
					default: f.default,
				}
		}
	})
}

// seedStyleValues writes each declared field's default into the one
// generic style store at registration, so the panel highlights a
// current choice before the first pick -- the plugin twin of the
// store's own INITIAL_VALUES entries.
export function seedStyleValues(kind: string, fields: readonly CanvasStyleFieldDecl[]): void {
	for (const f of fields) {
		useAtlasStyleValues.getState().setValue(kind, f.key, styleFieldDefault(f))
	}
}

// pluginGestureCtx narrows the kernel's own AtlasGestureCtx to the SDK
// contract (goal 0252 S1's design lock): board-space conversion, the
// tool's own current style values, creation scoped to the plugin's own
// declared object kind, the mirror-store bake, and -- only for a
// manifest that declares "erase-board-items" -- the erase door.
// Nothing else from the kernel ctx leaks.
function pluginGestureCtx(kind: string, objectKind: string, fields: readonly CanvasStyleFieldDecl[], canErase: boolean, ctx: AtlasGestureCtx): CanvasGestureCtx {
	const defaults: Record<string, AtlasStyleValue> = {}
	for (const f of fields) defaults[f.key] = styleFieldDefault(f)
	const out: CanvasGestureCtx = {
		screenToFlowPosition: ctx.screenToFlowPosition,
		styleValues: { ...defaults, ...(useAtlasStyleValues.getState().values[kind] ?? {}) },
		createObject: async (payload, flowPos, opts) => {
			const parent = frameContainingPoint(ctx.cardBoxes, flowPos) ?? ctx.parentID
			const created = await AtlasService.CreateBoardObject(objectKind, payload, { X: flowPos.x, Y: flowPos.y }, parent)
			if (opts?.size) await AtlasService.SetBoardObjectSize(created.ID, { W: opts.size.w, H: opts.size.h })
			await refreshAtlas()
			if (opts?.select) ctx.onShapeCreated(created.ID)
		},
		saveImageBytes: (base64, ext, title) => AtlasService.SaveImageBytes(base64, ext, title),
		itemsInRect: (rect) => {
			const r = ctx.enclosedIn(rect)
			return { cardIds: r.cardIDs, noteIds: r.noteIDs, objectIds: r.objectIDs }
		},
	}
	if (canErase) {
		// The built-in eraser's exact hit contract: every point tests
		// top-level LEAF boxes only (containers excluded -- a frame's
		// bounds cover its whole child area, so touching it would risk
		// sweeping the frame away); ids accumulate host-side in the
		// engine's own per-gesture scratch and never reach plugin code.
		out.eraseHitTest = (pt) => {
			const flow = ctx.screenToFlowPosition(pt)
			for (const id of pointHitIDs(flow, ctx.cardBoxes.filter((b) => !b.isFrame))) ctx.hitAccumulator.cardIDs.add(id)
			for (const id of pointHitIDs(flow, ctx.noteBoxes)) ctx.hitAccumulator.noteIDs.add(id)
			for (const id of pointHitIDs(flow, ctx.objectBoxes)) ctx.hitAccumulator.objectIDs.add(id)
		}
		out.commitErase = () => {
			const cardIDs = [...ctx.hitAccumulator.cardIDs]
			const noteIDs = [...ctx.hitAccumulator.noteIDs]
			const objectIDs = [...ctx.hitAccumulator.objectIDs]
			if (cardIDs.length + noteIDs.length + objectIDs.length === 0) return
			ctx.onDeleteSelection(cardIDs, noteIDs, objectIDs)
		}
	}
	return out
}

// pluginPreviewComponent wraps a plugin's DOM renderPreview into the
// generic {points, now} component the engine's ONE overlay slot
// renders -- absolute, wrapper-spanning, pointer-events disabled so it
// never steals the very drag it's rendering (the same conventions
// AtlasPencilLivePreview carried).
function pluginPreviewComponent(kind: string, render: (el: HTMLElement, points: AtlasGesturePoint[], now: number) => void): ComponentType<{ points: AtlasGesturePoint[]; now: number }> {
	return function PluginGesturePreview({ points, now }: { points: AtlasGesturePoint[]; now: number }) {
		const ref = useRef<HTMLDivElement>(null)
		useEffect(() => {
			if (ref.current) render(ref.current, points, now)
		})
		return createElement('div', {
			ref,
			'data-testid': `atlas-${kind}-plugin-preview`,
			style: { position: 'absolute', inset: 0, pointerEvents: 'none' },
		})
	}
}

// One emoji as a tray/palette icon -- wrapped into the octicon
// component shape the registry's `icon` field expects. The cast is the
// one place the two icon worlds meet; the rendered output honors the
// same size prop octicons do.
function emojiIcon(emoji: string): Icon {
	const Component = ({ size = 16 }: { size?: number | string }) =>
		createElement('span', { style: { fontSize: typeof size === 'number' ? `${size}px` : size, lineHeight: 1 }, 'aria-hidden': true }, emoji)
	return Component as unknown as Icon
}

// faceContent builds the registry content contribution -- null for an
// ephemeral tool (nothing is ever placed). A kind whose manifest names
// an entry page (goal 0349 S6) is drawn by that page in its own frame;
// otherwise renderFace, guaranteed non-null (canvasToolDeclError).
function faceContent(pluginId: string, decl: CanvasObjectDecl, ephemeral: boolean, frame?: { entry: string; version: string }): ThirdPartyNounShape['content'] {
	if (ephemeral) return null
	if (frame) {
		return {
			Component: pluginFramedFaceComponent(pluginId, decl, frame.entry, frame.version),
			ariaLabelKey: decl.label,
			role: undefined,
			// A frame swallows the pointer, so a framed face is always
			// interactive in the activation contract: shielded while
			// idle, live once selected.
			input: 'interactive',
			source: decl.source === 'file' ? { kind: 'file', pathKey: 'mirrorPath' } : decl.source === 'url' ? { kind: 'url', urlKey: 'url' } : { kind: 'board-local' },
			editRoute: adaptEditRoute(decl.editRoute),
		}
	}
	if (!decl.renderFace) return null
	return {
		Component: pluginFaceComponent(pluginId, { ...decl, renderFace: decl.renderFace }),
		// i18next returns an unknown key verbatim, so the label doubles
		// as the wrapper's accessible name -- a plugin has no locale
		// bundle to key into.
		ariaLabelKey: decl.label,
		role: undefined,
		// Input over the face (goal 0354): 'static' unless the plugin
		// says otherwise, so a face that draws a picture keeps the whole
		// canvas gesture set working over it exactly as before.
		input: decl.content === 'interactive' ? 'interactive' : 'static',
		source: decl.source === 'file' ? { kind: 'file', pathKey: 'mirrorPath' } : decl.source === 'url' ? { kind: 'url', urlKey: 'url' } : { kind: 'board-local' },
		editRoute: adaptEditRoute(decl.editRoute),
	}
}

// adaptEditRoute: a static route stays static; a resolver is wrapped
// into the kernel's own per-object EditRouteDecl. A resolver returning
// an unknown route resolves to 'none' -- the object still renders, it
// just has no edit door.
function adaptEditRoute(route: CanvasObjectDecl['editRoute']): EditRouteDecl {
	if (typeof route !== 'function') return { kind: route }
	return (object) => {
		const payload = Object.fromEntries(Object.entries(object.Payload ?? {}).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]])))
		const kind = route({ ID: object.ID, Kind: object.Kind ?? '', Payload: payload })
		return { kind: kind === 'inline' || kind === 'external-app' ? kind : 'none' }
	}
}

// shortcutConflictError -- a declared key must not collide with a
// built-in identity's key or another registered tool's; first
// registrant wins deterministically (the loader activates plugins in
// sorted id order), the loser is a visible registration error.
// menuItemsProblem validates a declaration's context-menu items (goal
// 0280): slug ids, unique, a label, a run function, enabled a function
// when present.
function menuItemsProblem(items: readonly CanvasObjectMenuItem[]): string | null {
	const seen = new Set<string>()
	for (const item of items) {
		if (!SLUG_PATTERN.test(item.id)) return `menu item id "${item.id}" must be a lowercase slug`
		if (seen.has(item.id)) return `menu item "${item.id}" is declared twice`
		seen.add(item.id)
		if (typeof item.label !== 'string' || item.label.trim() === '') return `menu item "${item.id}" needs a label`
		if (typeof item.run !== 'function') return `menu item "${item.id}" needs a run function`
		if (item.enabled !== undefined && typeof item.enabled !== 'function') return `menu item "${item.id}" enabled must be a function`
	}
	return null
}

function shortcutConflictError(key: string | undefined): string | null {
	if (!key) return null
	if (ATLAS_TOOL_IDENTITIES.some((i) => i.shortcutKey === key) || thirdPartyNouns().some((n) => n.shortcutKey === key)) {
		return `shortcutKey "${key}" is already taken by another tool`
	}
	return null
}

// buildThirdPartyNoun turns one validated SDK declaration into the
// full registry shape -- the hostApi's registerCanvasObject body,
// extracted whole so the API assembly stays a thin door. Throws with
// the plugin's own id in the message so a broken plugin names itself.
export function buildThirdPartyNoun(pluginId: string, manifest: Manifest, decl: CanvasObjectDecl): ThirdPartyNounShape {
	const contributed = (manifest.contributes?.canvasObjects ?? []).find((c) => c.kind === decl.kind)
	const frame = contributed?.entry ? { entry: contributed.entry, version: manifest.version } : undefined
	const declError = canvasToolDeclError(decl, !!frame) ?? shortcutConflictError(decl.shortcutKey)
	if (declError) throw new Error(`plugin ${pluginId}: ${declError}`)
	const interaction = decl.interaction ?? 'arm-then-click'
	const ephemeral = interaction === 'ephemeral-drag'
	const dragShaped = interaction !== 'arm-then-click'
	// Drag tools default sticky (repeated strokes are the point, the
	// drawing-tool convention); a click tool never is.
	const sticky = dragShaped ? (decl.sticky ?? true) : false
	const styleDecls = decl.styleFields ?? []
	const contribution = (manifest.contributes?.canvasObjects ?? []).find((c) => c.kind === decl.kind)
	const claimError = ephemeral ? null : ingestionClaimMismatch(contribution, decl.source)
	if (claimError) throw new Error(`plugin ${pluginId}: ${claimError}`)
	const canErase = (manifest.capabilities ?? []).includes('erase-board-items')
	return {
		id: decl.kind,
		interaction,
		thirdParty: true,
		pluginId,
		defaultPayload: { ...(decl.defaultPayload ?? {}) },
		// An ephemeral tool never places anything, so it claims no
		// dropped files either.
		fileExtensions: ephemeral ? [] : (contribution?.fileExtensions ?? []).map((e) => e.toLowerCase()),
		// Menu items bound to the object ctx (goal 0280); disabled ones are
		// omitted at render (useAtlasObjectMenu.ts), the palette's rule.
		menuItems: (decl.menuItems ?? []).map((item) => ({
			id: item.id,
			label: item.label,
			run: (object) => { item.run(pluginObjectCtx(pluginId, object)) },
			enabled: (object) => (item.enabled ? item.enabled(pluginObjectCtx(pluginId, object)) : true),
		})),
		icon: NAMED_GLYPHS[decl.icon] ?? emojiIcon(decl.icon),
		label: decl.label,
		nounName: decl.label,
		description: decl.description,
		shortcutKey: decl.shortcutKey ?? null,
		tray: 'quick',
		// An undeclared plugin face defaults to 'embed' (goal 0355): the
		// dock's visible buttons are fixed, so a face that names no
		// cluster is found through the More panel's search rather than
		// silently taking a dock slot a built-in noun owns.
		group: decl.group ?? 'embed',
		styleFields: adaptStyleFields(decl.kind, decl.label, styleDecls),
		lockable: decl.lockable ?? false,
		resizable: !ephemeral,
		boardNodeType: ephemeral ? null : 'atlas-object',
		dragBand: ephemeral ? false : (decl.dragBand ?? true),
		fileBacked: !ephemeral && decl.source === 'file',
		boardObjectKind: decl.objectKind ?? decl.kind,
		content: faceContent(pluginId, decl, ephemeral, frame),
		sticky,
		gesture: dragShaped && decl.gesture ? adaptGesture(decl.kind, decl.objectKind ?? decl.kind, styleDecls, decl.gesture, sticky, canErase) : null,
		commit: () => {
			throw new Error('third-party placement goes through useAtlasCreation’s generic branch, never commit()')
		},
	}
}

// adaptGesture builds the registry-facing AtlasToolGesture from a
// plugin's declaration. Disarm semantics are HOST-owned (the design
// lock): a non-sticky tool disarms after a COMPLETED drag's onEnd --
// gated on the engine's own shared drag threshold, because a stray
// armed click also reaches onEnd (the engine fires it
// unconditionally) and disarming there would unmount the tray button
// out from under that same click's own toggle handling. A sticky tool
// relies on the engine's gestureDisarmFns no-ops exactly like the
// drawing tools.
export function adaptGesture(kind: string, objectKind: string, fields: readonly CanvasStyleFieldDecl[], decl: CanvasGestureDecl, sticky: boolean, canErase: boolean): AtlasToolGesture {
	return {
		onPoint: decl.onPoint ? (pt, ctx) => decl.onPoint?.(pt, pluginGestureCtx(kind, objectKind, fields, canErase, ctx)) : undefined,
		onEnd: (points, ctx) => {
			try {
				decl.onEnd(points, pluginGestureCtx(kind, objectKind, fields, canErase, ctx))
			} finally {
				if (!sticky && meetsDragThreshold(points)) ctx.disarmUnlessLocked()
			}
		},
		preview: decl.renderPreview ? pluginPreviewComponent(kind, decl.renderPreview) : undefined,
		fadeMs: decl.fadeMs,
	}
}
