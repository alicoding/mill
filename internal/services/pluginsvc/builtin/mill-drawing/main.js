// Drawing -- Mill's bundled drawing plugin: the four board drawing
// tools -- pencil, shape, eraser, laser -- running on the same runtime
// extension surface any out-of-tree extension uses. Ships embedded in
// the app, loads like any extension, and can be disabled (or shadowed
// by a copy in the extensions folder) like any extension.
//
// It runs fully sandboxed: Mill owns every pointer event and paints
// every preview from the data these tools write, and each object's
// face is its own page. Nothing here can reach Mill's own window.
import { registerPencil } from './pencil.js'
import { registerShape } from './shape.js'
import { registerEraser } from './eraser.js'
import { registerLaser } from './laser.js'

// mill-drawing.showTips: the declared editor/context seat's worked
// example -- a plain command, seated on every drawing-kind object's own
// right-click menu (this plugin owns four kinds, so its editor/context
// item carries no per-kind scoping).
function registerContextMenuCommand(api) {
	api.registerCommand({
		id: 'mill-drawing.showTips',
		label: 'Drawing tips',
		run: () => api.notify({ level: 'info', text: 'Hold Shift while dragging the shape tool to keep its proportions.' }),
	})
}

// Registration order IS the tray's annotate-drawer order (the registry
// appends third-party tools in registration order).
export function activate(api) {
	registerPencil(api)
	registerEraser(api)
	registerLaser(api)
	registerShape(api)
	registerContextMenuCommand(api)
}
