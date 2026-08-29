import { memo, useEffect, useRef, type ComponentType } from 'react'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { CanvasObjectDecl, GuardedActionResult } from './sdk'

// pluginFaceComponent adapts a plugin's framework-agnostic
// renderFace(el, ctx) callback into the one React component shape the
// noun registry's content contract expects (AtlasNounContent.Component)
// -- the host owns the React mount; the plugin owns el's contents (the
// CodeMirror-widget/Obsidian-contentEl convergence, docs/goals/0249).
// renderFace re-runs whenever the object's own data changes; the
// plugin reads ctx.object to decide what to redraw.
export function pluginFaceComponent(pluginId: string, decl: CanvasObjectDecl): ComponentType<{ object: BoardObject; mirrorVersion: number }> {
	const Face = memo(function PluginFace({ object, mirrorVersion }: { object: BoardObject; mirrorVersion: number }) {
		const elRef = useRef<HTMLDivElement>(null)
		// Payload identity changes on every fetch; re-render on VALUE
		// change only, or a plugin's own updatePayload would re-invoke
		// renderFace mid-typing with a stale echo of what it just wrote.
		const payloadJSON = JSON.stringify(object.Payload ?? {})
		useEffect(() => {
			const el = elRef.current
			if (!el) return
			try {
				decl.renderFace(el, {
					object: {
						ID: object.ID,
						Kind: object.Kind,
						Payload: Object.fromEntries(Object.entries(object.Payload ?? {}).flatMap(([k, v]) => (v === undefined ? [] : [[k, v]]))),
					},
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
			// eslint-disable-next-line react-hooks/exhaustive-deps -- payloadJSON stands in for object.Payload's value identity (see above)
		}, [object.ID, payloadJSON, mirrorVersion])
		return <div ref={elRef} style={{ width: '100%', height: '100%', overflow: 'hidden' }} data-testid={`plugin-face-${decl.kind}`} />
	})
	return Face
}
