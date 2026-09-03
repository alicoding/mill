// Text case -- a step-only plugin (docs/adr/0051 §5): nothing on the
// board, so activate registers nothing. The step lives in steps.js,
// which Mill runs inside the workflow executor, not the webview.
export function activate() {}
