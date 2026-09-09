// The pencil: drag to draw a freehand ink stroke. The completed stroke
// bakes to a self-contained SVG file in Mill's mirror store
// (colour/size become document data, never re-read from the ephemeral
// style cache) and lands as an 'ink' object -- the same Kind, payload
// shape, and file format strokes had before, so old and new strokes
// are indistinguishable.
//
// Mill owns the pointer and paints the live stroke from the draft's
// own preview data: this file computes an outline and hands it over,
// and never touches the board.
import { livePreviewPathData, meetsDragThreshold, outlinePathData, strokeOutline, textToBase64 } from './lib.js'

const COLORS = ['#1f6feb', '#da3633', '#238636', '#9a6700', '#8250df', '#24292f']
const SIZES = [2, 4, 8]

function bakeStrokeSvg(points, color, size) {
	if (points.length < 2) return null
	const outline = strokeOutline(points, size)
	if (outline.length === 0) return null
	const xs = outline.map((p) => p[0])
	const ys = outline.map((p) => p[1])
	const originX = Math.min(...xs)
	const originY = Math.min(...ys)
	const width = Math.max(1, Math.max(...xs) - originX)
	const height = Math.max(1, Math.max(...ys) - originY)
	const normalized = outline.map(([x, y]) => [x - originX, y - originY])
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><path d="${outlinePathData(normalized)}" fill="${color}"/></svg>`
	return { svg, originX, originY, width, height }
}

// A stroke lands at the size it was drawn, capped so one long sweep
// never places a picture bigger than the screen and floored so a dot is
// still big enough to grab. Aspect ratio is kept: the cap scales both
// axes together.
const MAX_PLACED = 480
const MIN_PLACED = 40

function placedSize(width, height) {
	const scale = Math.min(1, MAX_PLACED / width, MAX_PLACED / height)
	return { w: Math.max(MIN_PLACED, width * scale), h: Math.max(MIN_PLACED, height * scale) }
}

export function registerPencil(api) {
	// Last-used style survives a restart: the declared defaults read the
	// plugin's own storage, each completed stroke writes back. A stored
	// value outside the option set falls back.
	const saved = api.storage.get('pencil') || {}
	const defaultColor = COLORS.includes(saved.color) ? saved.color : COLORS[0]
	const defaultSize = SIZES.includes(saved.size) ? saved.size : SIZES[1]

	let points = []
	let draft = null

	async function end(color, size) {
		const stroke = draft
		draft = null
		if (!stroke) return
		if (!meetsDragThreshold(points) || points.length < 2) {
			await stroke.discard()
			return
		}
		void api.storage.set('pencil', { color, size }).catch(console.error)
		const baked = bakeStrokeSvg(points, color, size)
		if (!baked) {
			await stroke.discard()
			return
		}
		// The stroke's own bounding-box origin is where the object lands,
		// so the placed picture sits exactly where it was drawn.
		const mirrorPath = await api.files.saveImageBytes(textToBase64(baked.svg), '.svg', 'Sketch')
		await stroke.patch({ at: { x: baked.originX, y: baked.originY }, size: placedSize(baked.width, baked.height), data: { mirrorPath, title: 'Sketch' } })
		await stroke.commit()
	}

	api.registerCanvasTool({
		kind: 'pencil',
		objectKind: 'ink',
		label: 'Draw with the pencil',
		description: 'Draws a freehand ink stroke on the board.',
		icon: 'pencil',
		cursor: 'crosshair',
		shortcutKey: 'P',
		group: 'annotate',
		source: 'file',
		editRoute: 'none',
		// An ink stroke's whole body already drags -- the shared band
		// would only be debris.
		dragBand: false,
		styleFields: [
			{ type: 'color', key: 'color', label: 'Color', options: COLORS, default: defaultColor },
			{ type: 'stroke-width', key: 'size', label: 'Size', render: 'dot', options: SIZES, default: defaultSize },
		],
		preview: { kind: 'path', from: 'trail', fill: 'trailFill' },
		async onPointer(event, ctx) {
			const color = String(ctx.styleValues.color || COLORS[0])
			const size = Number(ctx.styleValues.size) || SIZES[1]
			if (event.phase === 'down') {
				points = [event.point]
				draft = await ctx.createDraft({ at: event.point, preview: { trail: '', trailFill: color } })
				return
			}
			if (event.phase === 'cancel') {
				const stroke = draft
				draft = null
				points = []
				if (stroke) await stroke.discard()
				return
			}
			points = points.concat(event.coalesced, [event.point])
			if (event.phase === 'move') {
				if (draft) await draft.patch({ preview: { trail: livePreviewPathData(points, size), trailFill: color } })
				return
			}
			if (event.phase === 'up') await end(color, size)
		},
	})
}
