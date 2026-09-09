// Shared helpers for the Drawing plugin's four tools: the
// freehand-outline -> path conversion (the same outline math these
// tools have always used, so a stroke drawn before and one drawn after
// are indistinguishable) and the base64 encoding that bakes a finished
// stroke into a file.
//
// The tools themselves never touch a document -- Mill owns the pointer
// and paints every preview from the data they write; svgEl is for the
// placed object's own face, which an extension sharing Mill's window
// still draws itself.
import { getStroke } from './perfect-freehand.js'

export const MIN_DRAG_PX = 6

// A mouse/trackpad reports no real analog pressure, so width
// variation is simulated from drawing velocity -- the converged
// freehand-ink rendering convention.
const STROKE_OPTIONS = { thinning: 0.6, smoothing: 0.5, streamline: 0.5, simulatePressure: true }

export function meetsDragThreshold(points) {
	if (points.length < 2) return false
	const start = points[0]
	const end = points[points.length - 1]
	return Math.abs(end.x - start.x) >= MIN_DRAG_PX || Math.abs(end.y - start.y) >= MIN_DRAG_PX
}

// The perfect-freehand -> SVG path conversion: a quadratic curve
// through each outline edge's own midpoint smooths the raw polygon
// into a continuous stroke silhouette, closing back to the first
// point.
export function outlinePathData(outline) {
	if (outline.length === 0) return ''
	const start = outline[0]
	const d = outline.reduce(
		(acc, [x0, y0], i, arr) => {
			const [x1, y1] = arr[(i + 1) % arr.length]
			acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
			return acc
		},
		['M', start[0], start[1], 'Q'],
	)
	d.push('Z')
	return d.join(' ')
}

export function strokeOutline(points, size) {
	return getStroke(points.map((p) => [p.x, p.y]), { ...STROKE_OPTIONS, size })
}

// The in-progress drag's live trail: the same outline math as the
// committed artifact, in board coordinates -- Mill paints it from the
// draft and places the finished stroke at the same coordinates.
export function livePreviewPathData(points, size) {
	if (points.length < 2) return ''
	return outlinePathData(strokeOutline(points, size))
}

const SVG_NS = 'http://www.w3.org/2000/svg'

export function svgEl(tag, attrs) {
	const el = document.createElementNS(SVG_NS, tag)
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
	return el
}

// UTF-8-safe string -> base64 (TextEncoder + chunked btoa) for baking
// SVG text into the mirror store.
export function textToBase64(text) {
	const bytes = new TextEncoder().encode(text)
	const chunkSize = 0x8000
	let binary = ''
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
	}
	return btoa(binary)
}
