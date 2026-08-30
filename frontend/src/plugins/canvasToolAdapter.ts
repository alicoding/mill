import { createElement, useEffect, useRef } from 'react'
import type { ComponentType } from 'react'
import type { Icon } from '@primer/octicons-react'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from '../atlas/atlasStore'
import { frameContainingPoint } from '../atlas/atlasFramePoint'
import { useAtlasStyleValues, type AtlasStyleValue } from '../atlas/atlasStyleValueStore'
import type { AtlasStyleField } from '../atlas/atlasStyleVocabulary'
import type { AtlasGestureCtx, AtlasGesturePoint, AtlasToolGesture, ThirdPartyNounShape } from '../atlas/atlasNounRegistry'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { ingestionClaimMismatch } from './ingestionClaims'
import { pluginFaceComponent } from './PluginFaceContent'
import type { CanvasGestureCtx, CanvasGestureDecl, CanvasObjectDecl, CanvasStyleFieldDecl } from './sdk'

// The gesture/style half of a plugin's canvas registration (goal 0252
// S1): adapts the SDK's plain-data declarations onto the SAME registry
// fields built-in tools declare, so the tray's drag-to-draw branch,
// AtlasStylePanel, and the one gesture engine all serve a plugin tool
// with zero plugin-aware branches of their own.

// Registration-time validation, split out pure so a unit test can
// drive every refusal without touching the live registry. Returns an
// error string (with no plugin prefix -- the caller adds it) or null.
export function canvasToolDeclError(decl: CanvasObjectDecl): string | null {
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
	if (interaction !== 'ephemeral-drag' && typeof decl.renderFace !== 'function') {
		return 'renderFace must be a function (it is optional only for "ephemeral-drag")'
	}
	for (const f of decl.styleFields ?? []) {
		if (!['color', 'color-or-none', 'stroke-width'].includes(f.type)) {
			return `unknown style field type "${String((f as { type?: string }).type)}"`
		}
		if (!/^[a-zA-Z][a-zA-Z0-9-]{0,31}$/.test(f.key)) return `style field key "${f.key}" must be a short alphanumeric name`
		if (!Array.isArray(f.options) || f.options.length === 0) return `style field "${f.key}" needs a non-empty options list`
	}
	return null
}

// styleFieldDefault -- what a field's value starts at (the
// color-or-none vocabulary pins 'none' as that type's default).
export function styleFieldDefault(f: CanvasStyleFieldDecl): AtlasStyleValue {
	return f.type === 'color-or-none' ? 'none' : f.default
}

// adaptStyleFields fills the panel's own accessibility/test plumbing
// the SDK deliberately doesn't expose: testids derive from the kind,
// group labels render VERBATIM through i18next's missing-key fallback
// (a plugin has no locale bundle -- the same convention hostApi's
// ariaLabelKey already uses), and stroke-width option labels reuse the
// existing generic "{{size}}px"/"{{width}}px" strings so screen
// readers get real interpolated values.
export function adaptStyleFields(kind: string, label: string, fields: readonly CanvasStyleFieldDecl[]): AtlasStyleField[] {
	return fields.map((f): AtlasStyleField => {
		const base = { key: f.key, testidPrefix: `atlas-${kind}-${f.key}`, groupLabelKey: `${label} ${f.key}` }
		switch (f.type) {
			case 'color':
				return { ...base, type: 'color', options: f.options, default: f.default }
			case 'color-or-none':
				return { ...base, type: 'color-or-none', options: f.options, noneLabelKey: 'None', default: 'none' }
			case 'stroke-width': {
				const render = f.render ?? 'dot'
				return { ...base, type: 'stroke-width', render, options: f.options, optionLabelKey: render === 'dot' ? 'pencilStyle.sizeOption' : 'shapeStyle.widthOption', default: f.default }
			}
		}
	})
}

// seedStyleValues writes each declared field's default into the one
// generic style store at registration, so the panel highlights a
// current choice before the first pick -- the plugin twin of the
// store's own INITIAL_VALUES entries for shape/pencil.
export function seedStyleValues(kind: string, fields: readonly CanvasStyleFieldDecl[]): void {
	for (const f of fields) {
		useAtlasStyleValues.getState().setValue(kind, f.key, styleFieldDefault(f))
	}
}

// pluginGestureCtx narrows the kernel's own AtlasGestureCtx to the SDK
// contract (goal 0252 S1's design lock): board-space conversion, the
// tool's current style values, and creation scoped to this plugin's
// own kind -- nothing else leaks.
function pluginGestureCtx(kind: string, fields: readonly CanvasStyleFieldDecl[], ctx: AtlasGestureCtx): CanvasGestureCtx {
	const defaults: Record<string, AtlasStyleValue> = {}
	for (const f of fields) defaults[f.key] = styleFieldDefault(f)
	return {
		screenToFlowPosition: ctx.screenToFlowPosition,
		styleValues: { ...defaults, ...(useAtlasStyleValues.getState().values[kind] ?? {}) },
		createObject: async (payload, flowPos) => {
			const parent = frameContainingPoint(ctx.cardBoxes, flowPos) ?? ctx.parentID
			await AtlasService.CreateBoardObject(kind, payload, { X: flowPos.x, Y: flowPos.y }, parent)
			await refreshAtlas()
		},
	}
}

// pluginPreviewComponent wraps a plugin's DOM renderPreview into the
// generic {points, now} component the engine's ONE overlay slot
// renders -- absolute, wrapper-spanning, pointer-events disabled so it
// never steals the very drag it's rendering (the same conventions
// AtlasPencilLivePreview carries).
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

// One emoji as the tray/palette icon -- wrapped into the octicon
// component shape the registry's `icon` field expects. The cast is the
// one place the two icon worlds meet; the rendered output honors the
// same size prop octicons do.
function emojiIcon(emoji: string): Icon {
	const Component = ({ size = 16 }: { size?: number | string }) =>
		createElement('span', { style: { fontSize: typeof size === 'number' ? `${size}px` : size, lineHeight: 1 }, 'aria-hidden': true }, emoji)
	return Component as unknown as Icon
}

// faceContent builds the registry content contribution -- null for an
// ephemeral tool (nothing is ever placed); renderFace is guaranteed
// non-null for every other interaction (canvasToolDeclError).
function faceContent(pluginId: string, decl: CanvasObjectDecl, ephemeral: boolean): ThirdPartyNounShape['content'] {
	if (ephemeral || !decl.renderFace) return null
	return {
		Component: pluginFaceComponent(pluginId, { ...decl, renderFace: decl.renderFace }),
		// i18next returns an unknown key verbatim, so the label doubles
		// as the wrapper's accessible name -- a plugin has no locale
		// bundle to key into.
		ariaLabelKey: decl.label,
		role: undefined,
		source: decl.source === 'file' ? { kind: 'file', pathKey: 'mirrorPath' } : decl.source === 'url' ? { kind: 'url', urlKey: 'url' } : { kind: 'board-local' },
		editRoute: { kind: decl.editRoute },
	}
}

// buildThirdPartyNoun turns one validated SDK declaration into the
// full registry shape -- the hostApi's registerCanvasObject body,
// extracted whole so the API assembly stays a thin door. Throws with
// the plugin's own id in the message so a broken plugin names itself.
export function buildThirdPartyNoun(pluginId: string, manifest: Manifest, decl: CanvasObjectDecl): ThirdPartyNounShape {
	const declError = canvasToolDeclError(decl)
	if (declError) throw new Error(`plugin ${pluginId}: ${declError}`)
	const interaction = decl.interaction ?? 'arm-then-click'
	const ephemeral = interaction === 'ephemeral-drag'
	const dragShaped = interaction !== 'arm-then-click'
	// Drag tools default sticky (repeated strokes are the point, the
	// built-in pencil convention); a click tool never is.
	const sticky = dragShaped ? (decl.sticky ?? true) : false
	const styleDecls = decl.styleFields ?? []
	const contribution = (manifest.contributes?.canvasObjects ?? []).find((c) => c.kind === decl.kind)
	const claimError = ephemeral ? null : ingestionClaimMismatch(contribution, decl.source)
	if (claimError) throw new Error(`plugin ${pluginId}: ${claimError}`)
	return {
		id: decl.kind,
		interaction,
		thirdParty: true,
		pluginId,
		defaultPayload: { ...(decl.defaultPayload ?? {}) },
		// An ephemeral tool never places anything, so it claims no
		// dropped files either.
		fileExtensions: ephemeral ? [] : (contribution?.fileExtensions ?? []).map((e) => e.toLowerCase()),
		icon: emojiIcon(decl.icon),
		label: decl.label,
		nounName: decl.label,
		description: decl.description,
		shortcutKey: null,
		tray: 'quick',
		group: decl.source === 'file' ? 'file' : 'knowledge',
		styleFields: adaptStyleFields(decl.kind, decl.label, styleDecls),
		lockable: false,
		resizable: !ephemeral,
		boardNodeType: ephemeral ? null : 'atlas-object',
		dragBand: !ephemeral,
		fileBacked: !ephemeral && decl.source === 'file',
		boardObjectKind: decl.kind,
		content: faceContent(pluginId, decl, ephemeral),
		sticky,
		gesture: dragShaped && decl.gesture ? adaptGesture(decl.kind, styleDecls, decl.gesture, sticky) : null,
		commit: () => {
			throw new Error('third-party placement goes through useAtlasCreation’s generic branch, never commit()')
		},
	}
}

// adaptGesture builds the registry-facing AtlasToolGesture from a
// plugin's declaration. Disarm semantics are HOST-owned (the design
// lock): a non-sticky tool disarms after its own onEnd returns; a
// sticky one relies on the engine's gestureDisarmFns no-ops exactly
// like built-in pencil.
export function adaptGesture(kind: string, fields: readonly CanvasStyleFieldDecl[], decl: CanvasGestureDecl, sticky: boolean): AtlasToolGesture {
	return {
		onPoint: decl.onPoint ? (pt, ctx) => decl.onPoint?.(pt, pluginGestureCtx(kind, fields, ctx)) : undefined,
		onEnd: (points, ctx) => {
			try {
				decl.onEnd(points, pluginGestureCtx(kind, fields, ctx))
			} finally {
				if (!sticky) ctx.disarmUnlessLocked()
			}
		},
		preview: decl.renderPreview ? pluginPreviewComponent(kind, decl.renderPreview) : undefined,
		fadeMs: decl.fadeMs,
	}
}
