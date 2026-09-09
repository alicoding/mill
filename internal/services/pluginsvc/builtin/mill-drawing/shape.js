// The shape: drag to draw a rectangle, ellipse, or arrow -- one tool,
// the type picked in the style panel while armed. Geometry and style
// stay live Payload data (never a baked file), the exact payload shape
// these objects had before (shapeType/fill/stroke/strokeWidth/title,
// plus dx/dy for an arrow), so older shapes render identically.
import { meetsDragThreshold } from './lib.js'

const COLORS = ['#1f6feb', '#da3633', '#238636', '#9a6700', '#8250df', '#24292f']
const WIDTHS = [1, 2, 4]

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
			// An arrow's geometry is entirely dx/dy from its start point;
			// its box is just big enough to hold the line and its own
			// arrowhead.
			const floor = Math.max(style.width * 4, 8)
			await shape.patch({
				at: start,
				size: { w: Math.max(Math.abs(dx), floor), h: Math.max(Math.abs(dy), floor) },
				data: { ...base, dx: String(dx), dy: String(dy) },
			})
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
	})
}
