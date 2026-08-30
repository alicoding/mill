// The shape: drag to draw a rectangle, ellipse, or arrow -- one tool,
// the type picked in the style panel while armed. Geometry and style
// stay live Payload data (never a baked file), the exact payload
// shape objects had when this tool was compiled in
// (shapeType/fill/stroke/strokeWidth/title, plus dx/dy for an arrow),
// so pre-port shapes render identically.
import { ensureChild, ensurePreview, meetsDragThreshold, setAttrs, svgEl } from './lib.js'

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

export function registerShape(api) {
	let liveStyle = { type: 'rectangle', stroke: COLORS[0], width: WIDTHS[1] }

	api.registerCanvasObject({
		kind: 'shape',
		label: 'Draw a shape',
		description: 'Draws a rectangle, ellipse, or arrow.',
		icon: 'diamond',
		shortcutKey: 'S',
		group: 'annotate',
		source: 'board-local',
		editRoute: 'none',
		interaction: 'drag-to-draw',
		// The one discrete drag tool: a completed draw disarms it, and
		// re-clicking the armed button locks it for deliberate
		// repetition instead.
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
				default: 'rectangle',
			},
			{ type: 'color', key: 'stroke', label: 'Stroke', options: COLORS, default: COLORS[0] },
			{ type: 'stroke-width', key: 'width', label: 'Width', render: 'line', options: WIDTHS, default: WIDTHS[1] },
			{ type: 'color-or-none', key: 'fill', label: 'Fill', options: COLORS },
		],
		gesture: {
			onPoint(_pt, ctx) {
				const s = styleFrom(ctx.styleValues)
				liveStyle = { type: s.type, stroke: s.stroke, width: s.width }
			},
			renderPreview(el, points) {
				if (points.length < 1) {
					el.replaceChildren()
					return
				}
				const start = points[0]
				const current = points[points.length - 1]
				const svg = ensurePreview(el, 'atlas-shape-preview')
				const strokeAttrs = { 'stroke': liveStyle.stroke, 'stroke-width': liveStyle.width }
				if (liveStyle.type === 'arrow') {
					setAttrs(ensureChild(svg, 'line'), { x1: start.x, y1: start.y, x2: current.x, y2: current.y, 'stroke-linecap': 'round', ...strokeAttrs })
					return
				}
				const x = Math.min(start.x, current.x)
				const y = Math.min(start.y, current.y)
				const w = Math.abs(current.x - start.x)
				const h = Math.abs(current.y - start.y)
				if (liveStyle.type === 'rectangle') {
					setAttrs(ensureChild(svg, 'rect'), { x, y, 'width': w, 'height': h, 'fill': 'none', ...strokeAttrs })
				} else {
					setAttrs(ensureChild(svg, 'ellipse'), { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, 'fill': 'none', ...strokeAttrs })
				}
			},
			onEnd(points, ctx) {
				if (!meetsDragThreshold(points)) return
				const s = styleFrom(ctx.styleValues)
				const startFlow = ctx.screenToFlowPosition(points[0])
				const endFlow = ctx.screenToFlowPosition(points[points.length - 1])
				const dx = endFlow.x - startFlow.x
				const dy = endFlow.y - startFlow.y
				const title = shapeTitle(s.type)
				const base = { shapeType: s.type, fill: s.fill, stroke: s.stroke, strokeWidth: String(s.width), title }
				if (s.type === 'arrow') {
					// An arrow's geometry is entirely dx/dy from its start
					// point -- it carries no Size at all.
					void ctx.createObject({ ...base, dx: String(dx), dy: String(dy) }, startFlow, { select: true }).catch(console.error)
					return
				}
				const origin = { x: Math.min(startFlow.x, endFlow.x), y: Math.min(startFlow.y, endFlow.y) }
				const size = { w: Math.max(8, Math.abs(dx)), h: Math.max(8, Math.abs(dy)) }
				void ctx.createObject(base, origin, { size, select: true }).catch(console.error)
			},
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
