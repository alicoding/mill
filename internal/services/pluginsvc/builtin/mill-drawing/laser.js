// The laser: a fading pointer trail for pointing at things while
// talking. Nothing is ever created -- the trail renders from the
// gesture engine's own point accumulation and each point ages out on
// the host's fade clock, so there is nothing for a reload to read
// back.
import { ensurePreview, svgEl } from './lib.js'

// A point stays visible this long after being drawn -- long enough to
// trace a gesture while talking, short enough to never read as a
// lingering mark.
const FADE_MS = 700

export function registerLaser(api) {
	api.registerCanvasObject({
		kind: 'laser',
		label: 'Point with the laser',
		description: 'Points at things with a fading trail. Nothing is saved.',
		icon: 'zap',
		shortcutKey: 'L',
		group: 'annotate',
		source: 'board-local',
		editRoute: 'none',
		interaction: 'ephemeral-drag',
		gesture: {
			onEnd() {},
			fadeMs: FADE_MS,
			// A per-point dot whose opacity/radius fade linearly with
			// age -- each point fades INDEPENDENTLY (older = fainter),
			// which a single uniform-opacity path can't express.
			renderPreview(el, points, now) {
				if (points.length === 0) {
					el.replaceChildren()
					return
				}
				// The <svg> stays put across frames (element identity is
				// the stable part); only the dot list rebuilds.
				const svg = ensurePreview(el, 'atlas-laser-trail')
				const dots = points.map((p) => {
					const age = Math.min(1, Math.max(0, (now - p.t) / FADE_MS))
					return svgEl('circle', { cx: p.x, cy: p.y, r: 6 - age * 4, 'fill': '#ff3b30', 'fill-opacity': 1 - age })
				})
				svg.replaceChildren(...dots)
			},
		},
	})
}
