// The eraser: drag across board items to erase them. Whole-element
// only, top-level leaves only (containers are never swept), and never
// unrecoverable -- the host's erase door routes the accumulated hit
// set through the same undoable quick-delete every other delete uses,
// one undo step per pass. Requires the manifest's "erase-board-items"
// capability; without it the ctx carries no erase calls at all.
import { ensureChild, ensurePreview, livePreviewPathData, setAttrs } from './lib.js'

const TRAIL_SIZE = 18

export function registerEraser(api) {
	api.registerCanvasObject({
		kind: 'eraser',
		label: 'Erase things on the board',
		description: 'Erases whatever you drag over on the board.',
		icon: 'trash',
		shortcutKey: 'E',
		group: 'annotate',
		source: 'board-local',
		editRoute: 'none',
		// Places nothing, ever -- erasing destroys state rather than
		// creating any, which is exactly the ephemeral contract.
		interaction: 'ephemeral-drag',
		gesture: {
			// Every accumulated point -- including the very first, at
			// pointerdown, so a stationary click-erase works with zero
			// drag distance -- hit-tests through the host's door. Never
			// gated by a distance threshold: an eraser pass's own guard
			// is "did we touch anything", not how far the pointer moved.
			onPoint(pt, ctx) {
				ctx.eraseHitTest?.(pt)
			},
			onEnd(_points, ctx) {
				ctx.commitErase?.()
			},
			renderPreview(el, points) {
				const d = livePreviewPathData(points, TRAIL_SIZE)
				if (!d) {
					el.replaceChildren()
					return
				}
				const svg = ensurePreview(el, 'atlas-eraser-trail')
				setAttrs(ensureChild(svg, 'path'), { d, 'fill': '#da3633', 'fill-opacity': 0.35 })
			},
		},
	})
}
