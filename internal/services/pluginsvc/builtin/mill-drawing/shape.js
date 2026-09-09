// The shape: drag to draw a rectangle, ellipse, or arrow -- one tool,
// the type picked in the style panel while armed. Geometry and style
// stay live Payload data (never a baked file), the exact payload shape
// these objects had before (shapeType/fill/stroke/strokeWidth/title,
// plus dx/dy for an arrow), so older shapes render identically.
import { meetsDragThreshold, svgEl } from './lib.js'

const COLORS = ['#1f6feb', '#da3633', '#238636', '#9a6700', '#8250df', '#24292f']
const WIDTHS = [1, 2, 4]
const DEFAULT_W = 160
const DEFAULT_H = 100

// An arrow's bounding box derives purely from dx/dy, floored per axis
// so a flat arrow still has room for its own arrowhead; the <svg>
// renders overflow:visible so a marker bleeding a few px past the
// nominal box is never clipped.
function arrowGeometry(dx, dy, strokeWidth) {
	const floor = Math.max(strokeWidth * 4, 8)
	const w = Math.max(Math.abs(dx), floor)
	const h = Math.max(Math.abs(dy), floor)
	const x1 = dx < 0 ? w : 0
	const y1 = dy < 0 ? h : 0
	return { w, h, x1, y1, x2: x1 + dx, y2: y1 + dy }
}

function shapeTitle(type) {
	if (type === 'rectangle') return 'Rectangle'
	if (type === 'ellipse') return 'Ellipse'
	return 'Arrow'
}

function styleFrom(values) {
	return {
		type: String(values.type || 'rectangle'),
		stroke: String(values.stroke || COLORS[0]),
		width: Number(values.width) || WIDTHS[1],
		fill: String(values.fill || 'none'),
	}
}

// The live shape, as the one primitive Mill draws for it: an arrow is
// a line from where the drag started to where it is now; a rectangle
// and an ellipse are the box between the two.
function previewShape(style, start, current) {
	const paint = { stroke: style.stroke, strokeWidth: String(style.width), fill: 'none' }
	if (style.type === 'arrow') {
		return [{ kind: 'line', geometry: `${start.x},${start.y},${current.x},${current.y}`, ...paint }]
	}
	const x = Math.min(start.x, current.x)
	const y = Math.min(start.y, current.y)
	const w = Math.abs(current.x - start.x)
	const h = Math.abs(current.y - start.y)
	return [{ kind: style.type === 'ellipse' ? 'ellipse' : 'rect', geometry: `${x},${y},${w},${h}`, ...paint }]
}

export function registerShape(api) {
	// Last-used style survives a restart: declared defaults read the
	// plugin's own storage; each completed shape writes back. A stored
	// value outside an option set falls back to the shipped default.
	const saved = api.storage.get('shape') || {}
	const defaultType = ['rectangle', 'ellipse', 'arrow'].includes(saved.type) ? saved.type : 'rectangle'
	const defaultStroke = COLORS.includes(saved.stroke) ? saved.stroke : COLORS[0]
	const defaultWidth = WIDTHS.includes(saved.width) ? saved.width : WIDTHS[1]

	let start = null
	let points = []
	let draft = null

	async function end(style, current) {
		const shape = draft
		draft = null
		if (!shape) return
		if (!meetsDragThreshold(points) || !start) {
			await shape.discard()
			return
		}
		void api.storage.set('shape', { type: style.type, stroke: style.stroke, width: style.width }).catch(console.error)
		const dx = current.x - start.x
		const dy = current.y - start.y
		const base = { shapeType: style.type, fill: style.fill, stroke: style.stroke, strokeWidth: String(style.width), title: shapeTitle(style.type) }
		if (style.type === 'arrow') {
			// An arrow's geometry is entirely dx/dy from its start point --
			// it carries no size at all.
			await shape.patch({ at: start, data: { ...base, dx: String(dx), dy: String(dy) } })
			await shape.commit({ select: true })
			return
		}
		await shape.patch({
			at: { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y) },
			size: { w: Math.max(8, Math.abs(dx)), h: Math.max(8, Math.abs(dy)) },
			data: base,
		})
		await shape.commit({ select: true })
	}

	api.registerCanvasTool({
		kind: 'shape',
		label: 'Draw a shape',
		description: 'Draws a rectangle, ellipse, or arrow.',
		icon: 'diamond',
		cursor: 'crosshair',
		shortcutKey: 'S',
		group: 'annotate',
		source: 'board-local',
		editRoute: 'none',
		// The one discrete drag tool: a completed draw disarms it, and
		// re-clicking the armed button locks it for deliberate repetition
		// instead.
		sticky: false,
		lockable: true,
		// A shape's whole body already drags -- no band.
		dragBand: false,
		styleFields: [
			{
				type: 'shape-kind',
				key: 'type',
				label: 'Shape',
				options: [
					{ value: 'rectangle', icon: 'square', label: 'Rectangle' },
					{ value: 'ellipse', icon: 'circle', label: 'Ellipse' },
					{ value: 'arrow', icon: 'arrow-up-right', label: 'Arrow' },
				],
				default: defaultType,
			},
			{ type: 'color', key: 'stroke', label: 'Stroke', options: COLORS, default: defaultStroke },
			{ type: 'stroke-width', key: 'width', label: 'Width', render: 'line', options: WIDTHS, default: defaultWidth },
			{ type: 'color-or-none', key: 'fill', label: 'Fill', options: COLORS },
		],
		// The drawn primitive changes with the picker while the tool is
		// armed, so the preview is a list this tool rebuilds per frame
		// rather than one fixed kind.
		preview: { kind: 'shapes', from: 'live' },
		async onPointer(event, ctx) {
			const style = styleFrom(ctx.styleValues)
			if (event.phase === 'down') {
				start = event.point
				points = [event.point]
				draft = await ctx.createDraft({ at: event.point, preview: { live: JSON.stringify(previewShape(style, start, event.point)) } })
				return
			}
			if (event.phase === 'cancel') {
				const shape = draft
				draft = null
				start = null
				points = []
				if (shape) await shape.discard()
				return
			}
			points = points.concat(event.coalesced, [event.point])
			if (event.phase === 'move') {
				if (draft && start) await draft.patch({ preview: { live: JSON.stringify(previewShape(style, start, event.point)) } })
				return
			}
			if (event.phase === 'up') await end(style, event.point)
		},
		renderFace(el, ctx) {
			const payload = ctx.object.Payload
			const type = payload.shapeType
			const stroke = payload.stroke || '#1f6feb'
			const strokeWidth = Number(payload.strokeWidth) || 2
			const fill = payload.fill || 'none'
			el.style.cssText = 'width:100%;height:100%'
			if (type === 'arrow') {
				const g = arrowGeometry(Number(payload.dx) || 0, Number(payload.dy) || 0, strokeWidth)
				const svg = svgEl('svg', { 'data-testid': 'atlas-shape-content', 'width': g.w, 'height': g.h, viewBox: `0 0 ${g.w} ${g.h}` })
				svg.style.cssText = 'overflow:visible;display:block'
				const markerId = `arrowhead-${ctx.object.ID}`
				const defs = svgEl('defs', {})
				const marker = svgEl('marker', { id: markerId, markerWidth: 8, markerHeight: 8, refX: 6, refY: 4, orient: 'auto' })
				marker.append(svgEl('path', { d: 'M0,0 L8,4 L0,8 Z', fill: stroke }))
				defs.append(marker)
				const line = svgEl('line', { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, 'stroke': stroke, 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'marker-end': `url(#${markerId})` })
				svg.append(defs, line)
				el.replaceChildren(svg)
				return
			}
			// Rectangle/ellipse fill their container (100%/100% +
			// preserveAspectRatio none, geometry addressed through the
			// viewBox alone) so the paint never exceeds the node's box
			// and tracks the pointer live during a resize.
			const w = ctx.object.Size ? ctx.object.Size.W : DEFAULT_W
			const h = ctx.object.Size ? ctx.object.Size.H : DEFAULT_H
			const inset = strokeWidth / 2
			const svg = svgEl('svg', { 'data-testid': 'atlas-shape-content', 'width': '100%', 'height': '100%', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' })
			svg.style.cssText = 'display:block'
			if (type === 'ellipse') {
				svg.append(svgEl('ellipse', { cx: w / 2, cy: h / 2, rx: Math.max(0, w / 2 - inset), ry: Math.max(0, h / 2 - inset), 'fill': fill, 'stroke': stroke, 'stroke-width': strokeWidth }))
			} else {
				svg.append(svgEl('rect', { x: inset, y: inset, 'width': Math.max(0, w - strokeWidth), 'height': Math.max(0, h - strokeWidth), 'fill': fill, 'stroke': stroke, 'stroke-width': strokeWidth }))
			}
			el.replaceChildren(svg)
		},
	})
}
