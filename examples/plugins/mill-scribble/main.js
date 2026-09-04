// @ts-check
/// <reference path="../../../frontend/plugin-sdk/index.d.ts" />

// Scribble -- the reference DRAG-SHAPED runtime plugin (goal 0252 S1),
// proving the three plugin doors built-in drawing tools use: the
// gesture engine (interaction: drag-to-draw), the style picker
// (styleFields), and the live-preview overlay (renderPreview). Plain
// ESM, no build step, exactly like mill-bookmark.
//
// The stroke is board-local data: its points are normalized to the
// stroke's own bounding box and stored in the object payload, so the
// face redraws them at any size with no file behind it.

const COLORS = ['#1f6feb', '#da3633', '#238636', '#8250df']
const WIDTHS = [2, 4, 8]
const MIN_DRAG_PX = 6

function polylineSvg(el, points, color, width, viewW, viewH) {
	const ns = 'http://www.w3.org/2000/svg'
	const svg = document.createElementNS(ns, 'svg')
	svg.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`)
	svg.setAttribute('preserveAspectRatio', 'none')
	svg.style.cssText = 'width:100%;height:100%;display:block'
	const line = document.createElementNS(ns, 'polyline')
	line.setAttribute('points', points.map((p) => `${p.x},${p.y}`).join(' '))
	line.setAttribute('fill', 'none')
	line.setAttribute('stroke', color)
	line.setAttribute('stroke-width', String(width))
	line.setAttribute('stroke-linecap', 'round')
	line.setAttribute('stroke-linejoin', 'round')
	svg.append(line)
	el.replaceChildren(svg)
}

/** @param {import('../../../frontend/plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	// renderPreview has no ctx of its own -- capture the current style
	// from onPoint's ctx (fired per accumulated point) so the live
	// stroke previews in the picked color/width, not the defaults.
	let liveStyle = { color: COLORS[0], size: WIDTHS[1] }

	api.registerCanvasObject({
		kind: 'scribble',
		label: 'Scribble',
		description: 'Drag to draw a freehand stroke on the board.',
		icon: '✍️',
		source: 'board-local',
		editRoute: 'none',
		interaction: 'drag-to-draw',
		styleFields: [
			{ type: 'color', key: 'color', options: COLORS, default: COLORS[0] },
			{ type: 'stroke-width', key: 'size', options: WIDTHS, default: WIDTHS[1] },
		],
		gesture: {
			onPoint(_pt, ctx) {
				liveStyle = {
					color: String(ctx.styleValues.color || COLORS[0]),
					size: Number(ctx.styleValues.size) || WIDTHS[1],
				}
			},
			renderPreview(el, points) {
				if (points.length < 2) {
					el.replaceChildren()
					return
				}
				const rect = el.getBoundingClientRect()
				polylineSvg(el, points, liveStyle.color, liveStyle.size, rect.width, rect.height)
			},
			onEnd(points, ctx) {
				if (points.length < 2) return
				const first = points[0]
				const last = points[points.length - 1]
				if (Math.abs(last.x - first.x) < MIN_DRAG_PX && Math.abs(last.y - first.y) < MIN_DRAG_PX) return

				const xs = points.map((p) => p.x)
				const ys = points.map((p) => p.y)
				const minX = Math.min(...xs)
				const minY = Math.min(...ys)
				const w = Math.max(1, Math.max(...xs) - minX)
				const h = Math.max(1, Math.max(...ys) - minY)
				const local = points.map((p) => ({ x: Math.round(p.x - minX), y: Math.round(p.y - minY) }))
				const flowOrigin = ctx.screenToFlowPosition({ x: minX, y: minY })
				const color = String(ctx.styleValues.color || COLORS[0])
				const size = Number(ctx.styleValues.size) || WIDTHS[1]
				void ctx.createObject(
					{ points: JSON.stringify(local), w: String(Math.round(w)), h: String(Math.round(h)), color, size: String(size) },
					flowOrigin,
				)
			},
		},
		renderFace(el, ctx) {
			let points = []
			try {
				points = JSON.parse(ctx.object.Payload.points || '[]')
			} catch {
				points = []
			}
			if (points.length < 2) {
				el.replaceChildren()
				return
			}
			el.style.cssText = 'width:100%;height:100%;padding:4px;box-sizing:border-box'
			polylineSvg(
				el,
				points,
				ctx.object.Payload.color || COLORS[0],
				Number(ctx.object.Payload.size) || WIDTHS[1],
				Number(ctx.object.Payload.w) || 100,
				Number(ctx.object.Payload.h) || 100,
			)
		},
	})
}
