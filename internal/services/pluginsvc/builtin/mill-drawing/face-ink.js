// An ink stroke's face: the baked SVG file, drawn as a picture that
// fills the object's box. Its bytes are never available any sooner
// than this same read, so an empty frame is the honest "not there yet"
// state; only a FAILED read says anything.
const mill = window.acquireMillApi()
const face = document.getElementById('face')

function draw() {
	const mirror = mill.context.mirror
	if (mirror && mirror.dataUrl) {
		const img = document.createElement('img')
		img.src = mirror.dataUrl
		img.alt = ''
		img.draggable = false
		face.replaceChildren(img)
		return
	}
	if (mirror && mirror.failed) {
		const problem = document.createElement('span')
		problem.className = 'problem'
		problem.textContent = "Couldn't load this file."
		face.replaceChildren(problem)
		return
	}
	face.replaceChildren()
}

draw()
mill.on('ctx', draw)
