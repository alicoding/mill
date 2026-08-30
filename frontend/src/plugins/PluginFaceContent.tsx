import { memo, useEffect, useRef, type ComponentType } from 'react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { MirrorReadState } from '../atlas/useAtlasObjectMirrorRead'
import type { CanvasObjectDecl, GuardedActionResult } from './sdk'

// pluginFaceComponent adapts a plugin's framework-agnostic
// renderFace(el, ctx) callback into the one React component shape the
// noun registry's content contract expects (AtlasNounContent.Component)
// -- the host owns the React mount; the plugin owns el's contents (the
// CodeMirror-widget/Obsidian-contentEl convergence, docs/goals/0249).
// renderFace re-runs whenever the object's own data changes -- or, for
// a file-source object, when its mirrored bytes load/change (the host
// already owns that read; goal 0252 S2 passes it through as
// ctx.mirror) -- the plugin reads ctx to decide what to redraw.
export function pluginFaceComponent(pluginId: string, decl: CanvasObjectDecl & { renderFace: NonNullable<CanvasObjectDecl['renderFace']> }): ComponentType<{ object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState }> {
	const fileSource = decl.source === 'file'
	const Face = memo(function PluginFace({ object, mirrorVersion, mirrorContent }: { object: BoardObject; mirrorVersion: number; mirrorContent?: MirrorReadState }) {
		const elRef = useRef<HTMLDivElement>(null)
		// Payload identity changes on every fetch; re-render on VALUE
		// change only, or a plugin's own updatePayload would re-invoke
		// renderFace mid-typing with a stale echo of what it just wrote.
		const payloadJSON = JSON.stringify(object.Payload ?? {})
		const content = mirrorContent?.content
		const mirrorDataUrl = content?.MimeType && content?.Content ? `data:${content.MimeType};base64,${content.Content}` : null
		const mirrorFailed = !!mirrorContent?.error || (!!content && !mirrorDataUrl)
		const sizeJSON = object.Size ? JSON.stringify(object.Size) : ''
		useEffect(() => {
			const el = elRef.current
			if (!el) return
			try {
				decl.renderFace(el, {
					object: {
						ID: object.ID,
						Kind: object.Kind,
						Payload: Object.fromEntries(Object.entries(object.Payload ?? {}).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]]))),
						Size: object.Size ? { W: object.Size.W, H: object.Size.H } : null,
					},
					mirror: fileSource ? { dataUrl: mirrorDataUrl, failed: mirrorFailed } : undefined,
					updatePayload: async (patch) => {
						await AtlasService.SetBoardObjectPayload(object.ID, patch)
					},
					requestGuardedAction: async (kind, attributes, description): Promise<GuardedActionResult> => {
						const d = await PluginService.RequestGuardedAction(pluginId, kind, attributes, description)
						return { approved: d.Approved, effect: d.Effect, ruleLabel: d.RuleLabel, performed: d.Performed }
					},
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
