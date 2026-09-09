// A shape's face: rectangle, ellipse or arrow, drawn from the object's
// own payload. Geometry and style are live data, never a baked file, so
// a style change redraws with no file to rewrite.
const SVG_NS = 'http://www.w3.org/2000/svg'
const mill = window.acquireMillApi()
const face = document.getElementById('face')

function svgEl(tag, attrs) {
	const el = document.createElementNS(SVG_NS, tag)
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
	return el
}

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

function drawArrow(object, payload, stroke, strokeWidth) {
	const g = arrowGeometry(Number(payload.dx) || 0, Number(payload.dy) || 0, strokeWidth)
	const svg = svgEl('svg', { 'data-testid': 'atlas-shape-content', width: '100%', height: '100%', viewBox: `0 0 ${g.w} ${g.h}`, preserveAspectRatio: 'none' })
	svg.style.overflow = 'visible'
	const markerId = `arrowhead-${object.ID}`
	const defs = svgEl('defs', {})
	const marker = svgEl('marker', { id: markerId, markerWidth: 8, markerHeight: 8, refX: 6, refY: 4, orient: 'auto' })
	marker.append(svgEl('path', { d: 'M0,0 L8,4 L0,8 Z', fill: stroke }))
	defs.append(marker)
	svg.append(defs, svgEl('line', { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, 'stroke': stroke, 'stroke-width': strokeWidth, 'stroke-linecap': 'round', 'marker-end': `url(#${markerId})` }))
	return svg
}

function draw() {
	const object = mill.context.object
	if (!object) return
	const payload = object.Payload || {}
	const stroke = payload.stroke || '#1f6feb'
	const strokeWidth = Number(payload.strokeWidth) || 2
	const fill = payload.fill || 'none'
	if (payload.shapeType === 'arrow') {
		face.replaceChildren(drawArrow(object, payload, stroke, strokeWidth))
		return
	}
	// Rectangle/ellipse fill their container (100%/100% +
	// preserveAspectRatio none, geometry addressed through the viewBox
	// alone) so the paint never exceeds the object's box and tracks the
	// pointer live during a resize.
	const w = object.Size ? object.Size.W : 160
	const h = object.Size ? object.Size.H : 100
	const inset = strokeWidth / 2
	const svg = svgEl('svg', { 'data-testid': 'atlas-shape-content', width: '100%', height: '100%', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none' })
	if (payload.shapeType === 'ellipse') {
		svg.append(svgEl('ellipse', { cx: w / 2, cy: h / 2, rx: Math.max(0, w / 2 - inset), ry: Math.max(0, h / 2 - inset), 'fill': fill, 'stroke': stroke, 'stroke-width': strokeWidth }))
	} else {
		svg.append(svgEl('rect', { x: inset, y: inset, width: Math.max(0, w - strokeWidth), height: Math.max(0, h - strokeWidth), 'fill': fill, 'stroke': stroke, 'stroke-width': strokeWidth }))
	}
	face.replaceChildren(svg)
}

draw()
mill.on('ctx', draw)
