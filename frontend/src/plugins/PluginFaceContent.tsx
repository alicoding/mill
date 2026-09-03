import { memo, useEffect, useRef, type ComponentType } from 'react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { MirrorReadState } from '../atlas/useAtlasObjectMirrorRead'
import type { CanvasObjectDecl, CanvasObjectFaceCtx, GuardedActionResult } from './sdk'

// pluginFaceComponent adapts a plugin's framework-agnostic
// renderFace(el, ctx) callback into the one React component shape the
// noun registry's content contract expects (AtlasNounContent.Component)
// -- the host owns the React mount; the plugin owns el's contents (the
// CodeMirror-widget/Obsidian-contentEl convergence, docs/goals/0249).
// renderFace re-runs whenever the object's own data changes -- or, for
// a file-source object, when its mirrored bytes load/change (the host
// already owns that read; goal 0252 S2 passes it through as
// ctx.mirror) -- the plugin reads ctx to decide what to redraw.
// pluginObjectCtx -- the object half of a face ctx (goal 0280): what a
// menu item's run() receives, and what the face itself spreads its
// mirror state onto. One construction, so a plugin sees the same
// object shape from both doors.
// mountOffBoardStage is the ctx.mountOffBoard door's implementation: a
// fixed-position host wrapper parked far off-screen (never display:none
// -- a hidden subtree measures as zero, which is the very problem the
// door solves), sized exactly, holding the plugin's element. `stages`
// collects every live detach so the face's unmount can sweep what a
// plugin forgot.
function mountOffBoardStage(el: Element, size: { w: number; h: number }, stages: Set<() => void>): () => void {
	const host = document.createElement('div')
	host.setAttribute('data-plugin-offboard-stage', '')
	host.style.cssText = `position:fixed;left:-100000px;top:0;width:${Math.max(1, size.w)}px;height:${Math.max(1, size.h)}px;overflow:hidden;pointer-events:none`
	host.append(el)
	document.body.append(host)
	const detach = () => {
		host.remove()
		stages.delete(detach)
	}
	stages.add(detach)
	return detach
}

export function pluginObjectCtx(pluginId: string, object: BoardObject, stages: Set<() => void> = new Set()): Omit<CanvasObjectFaceCtx, 'mirror'> {
	return {
		object: {
			ID: object.ID,
			Kind: object.Kind,
			Payload: Object.fromEntries(Object.entries(object.Payload ?? {}).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]]))),
			Size: object.Size ? { W: object.Size.W, H: object.Size.H } : null,
		},
		updatePayload: async (patch) => {
			await AtlasService.SetBoardObjectPayload(object.ID, patch)
		},
		requestGuardedAction: async (kind, attributes, description): Promise<GuardedActionResult> => {
			const d = await PluginService.RequestGuardedAction(pluginId, kind, attributes, description)
			return { approved: d.Approved, effect: d.Effect, ruleLabel: d.RuleLabel, performed: d.Performed }
		},
		mountOffBoard: (el, size) => mountOffBoardStage(el, size, stages),
	}
}

export function pluginFaceComponent(pluginId: string, decl: CanvasObjectDecl & { renderFace: NonNullable<CanvasObjectDecl['renderFace']> }): ComponentType<{ object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState }> {
	const fileSource = decl.source === 'file'
	const Face = memo(function PluginFace({ object, mirrorVersion, mirrorContent }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState }) {
		const elRef = useRef<HTMLDivElement>(null)
		// Off-board stages this face mounted and has not detached yet;
		// swept on unmount so a plugin's forgotten stage never outlives
		// its object.
		const stagesRef = useRef(new Set<() => void>())
		useEffect(() => () => { for (const detach of [...stagesRef.current]) detach() }, [])
		// Payload identity changes on every fetch; re-render on VALUE
		// change only, or a plugin's own updatePayload would re-invoke
		// renderFace mid-typing with a stale echo of what it just wrote.
		const payloadJSON = JSON.stringify(object.Payload ?? {})
		const content = mirrorContent?.content
		// Binary kinds arrive base64-encoded with a MIME type; a text kind
		// (markdown source, json, csv, .env -- ClassifyMirrorKind's text
		// set) arrives as the raw text with no MIME type, and reaches the
		// plugin as a text/plain data: URL so every file kind the mirror
		// door reads is one a plugin face can decode.
		const mirrorDataUrl = content?.MimeType && content?.Content
			? `data:${content.MimeType};base64,${content.Content}`
			: content?.Kind === 'text' && typeof content.Content === 'string'
				? `data:text/plain;charset=utf-8,${encodeURIComponent(content.Content)}`
				: null
		const mirrorFailed = !!mirrorContent?.error || (!!content && !mirrorDataUrl)
		const sizeJSON = object.Size ? JSON.stringify(object.Size) : ''
		useEffect(() => {
			const el = elRef.current
			if (!el) return
			try {
				decl.renderFace(el, {
					...pluginObjectCtx(pluginId, object, stagesRef.current),
					mirror: fileSource ? { dataUrl: mirrorDataUrl, failed: mirrorFailed } : undefined,
				})
			} catch (err) {
				// A plugin's render crash stays inside its own face --
				// never up into the board tree.
				console.error(`plugin ${pluginId} renderFace failed`, err)
			}
			// eslint-disable-next-line react-hooks/exhaustive-deps -- payloadJSON/sizeJSON stand in for object.Payload/Size value identity (see above)
		}, [object.ID, payloadJSON, sizeJSON, mirrorVersion, mirrorDataUrl, mirrorFailed])
		return <div ref={elRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} data-testid={`plugin-face-${decl.kind}`} />
	})
	return Face
}
