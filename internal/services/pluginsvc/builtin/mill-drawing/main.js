// Drawing -- Mill's bundled drawing plugin (goal 0252): the four
// board drawing tools -- pencil, shape, eraser, laser -- running on
// the same runtime plugin surface any out-of-tree plugin uses. Ships
// embedded in the app, loads like any plugin, and can be disabled (or
// shadowed by a copy in the plugins folder) like any plugin.
import { registerPencil } from './pencil.js'
import { registerShape } from './shape.js'
import { registerEraser } from './eraser.js'
import { registerLaser } from './laser.js'

// Registration order IS the tray's annotate-drawer order (the
// registry appends third-party tools in registration order) -- kept
// to the order the compiled-in tools rendered in.
export function activate(api) {
	registerPencil(api)
	registerEraser(api)
	registerLaser(api)
	registerShape(api)
}
