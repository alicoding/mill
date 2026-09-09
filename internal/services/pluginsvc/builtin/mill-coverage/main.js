// Mill's bundled Coverage plugin (goal 0357 S2): the board's own
// "known, not mapped" counts, running on the same runtime plugin
// surface any out-of-tree plugin uses. Everything the view needs
// lives in its sandboxed entry page (view.html/view.js); there is
// nothing to activate in Mill's own context.
export function activate() {}
