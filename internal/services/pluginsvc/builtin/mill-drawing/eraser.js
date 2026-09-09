// The eraser: drag across board items to erase them. Whole-element
// only, top-level leaves only (containers are never swept), and never
// unrecoverable -- the host's erase door routes the accumulated hit set
// through the same undoable quick-delete every other delete uses, one
// undo step per pass. Requires the manifest's "erase-board-items"
// capability; without it the tool ctx carries no erase calls at all.
import { livePreviewPathData } from './lib.js'

// The trail's thickness on SCREEN. Board geometry is what crosses the
// wire, so the drawn width divides by the current zoom to stay the same
// thickness however far the board is zoomed out.
const TRAIL_SCREEN_PX = 18

export function registerEraser(api) {
	let points = []
	let draft = null

	api.registerCanvasTool({
		kind: 'eraser',
		label: 'Erase things on the board',
		description: 'Erases whatever you drag over on the board.',
		icon: 'trash',
		cursor: 'crosshair',
		shortcutKey: 'E',
		group: 'annotate',
		source: 'board-local',
		editRoute: 'none',
		// Places nothing, ever -- erasing destroys state rather than
		// creating any, which is exactly the ephemeral contract.
		ephemeral: true,
		preview: { kind: 'path', from: 'trail', fill: 'trailFill', opacity: 'trailOpacity' },
		async onPointer(event, ctx) {
			if (event.phase === 'cancel') {
				const trail = draft
				draft = null
				points = []
				if (trail) await trail.discard()
				return
			}
			// Every accumulated point -- including the very first, at
			// pointer-down, so a stationary click-erase works with zero drag
			// distance -- hit-tests through the host's door. Never gated by
			// a distance threshold: an eraser pass's own guard is "did we
			// touch anything", not how far the pointer moved.
			const fresh = event.phase === 'down' ? [event.point] : event.coalesced.concat([event.point])
			for (const point of fresh) await ctx.eraseAt?.(point)
			if (event.phase === 'down') {
				points = fresh
				draft = await ctx.createDraft({ at: event.point, preview: { trail: '', trailFill: '#da3633', trailOpacity: '0.35' } })
				return
			}
			points = points.concat(fresh)
			if (event.phase === 'move') {
				if (draft) await draft.patch({ preview: { trail: livePreviewPathData(points, TRAIL_SCREEN_PX / (event.zoom || 1)) } })
				return
			}
			if (event.phase === 'up') {
				const trail = draft
				draft = null
				points = []
				await ctx.commitErase?.()
				if (trail) await trail.discard()
			}
		},
	})
}
