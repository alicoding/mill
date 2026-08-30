// The pencil: drag to draw a freehand ink stroke. The completed
// stroke bakes to a self-contained SVG file in Mill's mirror store
// (colour/size become document data, never re-read from the ephemeral
// style cache) and lands as an 'ink' object -- the same Kind, payload
// shape, and file format strokes had when this tool was compiled in,
// so old and new strokes are indistinguishable.
import { ensureChild, ensurePreview, livePreviewPathData, meetsDragThreshold, outlinePathData, setAttrs, strokeOutline, textToBase64 } from './lib.js'

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
	return { svg, originX, originY }
}

export function registerPencil(api) {
	let liveStyle = { color: COLORS[0], size: SIZES[1] }

	api.registerCanvasObject({
		kind: 'pencil',
		objectKind: 'ink',
		label: 'Draw with the pencil',
		description: 'Draws a freehand ink stroke on the board.',
		icon: 'pencil',
		shortcutKey: 'P',
		group: 'annotate',
		source: 'file',
		editRoute: 'none',
		interaction: 'drag-to-draw',
		// An ink stroke's whole body already drags -- the shared band
		// would only be debris.
		dragBand: false,
		styleFields: [
			{ type: 'color', key: 'color', label: 'Color', options: COLORS, default: COLORS[0] },
			{ type: 'stroke-width', key: 'size', label: 'Size', render: 'dot', options: SIZES, default: SIZES[1] },
		],
		gesture: {
			onPoint(_pt, ctx) {
				liveStyle = { color: String(ctx.styleValues.color || COLORS[0]), size: Number(ctx.styleValues.size) || SIZES[1] }
			},
			renderPreview(el, points) {
				const d = livePreviewPathData(points, liveStyle.size)
				if (!d) {
					el.replaceChildren()
					return
				}
				const svg = ensurePreview(el, 'atlas-pencil-preview')
				setAttrs(ensureChild(svg, 'path'), { d, fill: liveStyle.color })
			},
			onEnd(points, ctx) {
				if (!meetsDragThreshold(points) || points.length < 2) return
				const color = String(ctx.styleValues.color || COLORS[0])
				const size = Number(ctx.styleValues.size) || SIZES[1]
				const baked = bakeStrokeSvg(points, color, size)
				if (!baked) return
				// The stroke's own bounding-box origin converts through
				// screenToFlowPosition so the object lands exactly where
				// it was drawn.
				const flowOrigin = ctx.screenToFlowPosition({ x: baked.originX, y: baked.originY })
				void ctx
					.saveImageBytes(textToBase64(baked.svg), '.svg', 'Sketch')
					.then((mirrorPath) => ctx.createObject({ mirrorPath, title: 'Sketch' }, flowOrigin))
					.catch(console.error)
			},
		},
		renderFace(el, ctx) {
			el.style.cssText = 'width:100%;height:100%'
			if (ctx.mirror && ctx.mirror.dataUrl) {
				const img = document.createElement('img')
				img.src = ctx.mirror.dataUrl
				img.alt = ''
				img.draggable = false
				// The mirror-image sizing contract: natural size clamped
				// to a usable range until the user resizes; a persisted
				// Size wins and the image fills the node's box.
				img.style.cssText = ctx.object.Size
					? 'display:block;width:100%;height:100%;object-fit:contain;border-radius:6px'
					: 'display:block;max-width:480px;max-height:480px;min-width:40px;min-height:40px;width:auto;height:auto;border-radius:6px'
				el.replaceChildren(img)
				return
			}
			// An ink stroke's bytes are never available any sooner than
			// this same mirror read, so an empty frame is the honest
			// "not there yet" state; only a FAILED read says anything.
			if (ctx.mirror && ctx.mirror.failed) {
				const err = document.createElement('span')
				err.textContent = "Couldn't load this file."
				err.style.cssText = 'font-size:11px;color:var(--fgColor-danger)'
				el.replaceChildren(err)
				return
			}
			el.replaceChildren()
		},
	})
}
