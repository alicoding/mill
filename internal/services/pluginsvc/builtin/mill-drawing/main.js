// Drawing -- Mill's bundled drawing plugin (goal 0252): the four
// board drawing tools -- pencil, shape, eraser, laser -- running on
// the same runtime plugin surface any out-of-tree plugin uses. Ships
// embedded in the app, loads like any plugin, and can be disabled (or
// shadowed by a copy in the plugins folder) like any plugin.
import { registerPencil } from './pencil.js'
import { registerShape } from './shape.js'
import { registerEraser } from './eraser.js'
import { registerLaser } from './laser.js'

// mill-drawing.showTips (goal 0349 S2b): the declared editor/context
// seat's worked example -- a plain host-side command, seated on every
// drawing-kind object's own right-click menu (this plugin owns four
// kinds, so its editor/context item carries no per-kind scoping,
// matching the design contract's kind-owning case).
function registerContextMenuCommand(api) {
	api.registerCommand({
		id: 'mill-drawing.showTips',
		label: 'Drawing tips',
		run: () => api.notify({ level: 'info', text: 'Hold Shift while dragging the shape tool to keep its proportions.' }),
	})
}

// Registration order IS the tray's annotate-drawer order (the
// registry appends third-party tools in registration order) -- kept
// to the order the compiled-in tools rendered in.
export function activate(api) {
	registerPencil(api)
	registerEraser(api)
	registerLaser(api)
	registerShape(api)
	registerContextMenuCommand(api)
}
