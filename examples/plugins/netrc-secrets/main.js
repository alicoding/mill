// @ts-check
/// <reference path="../../../frontend/plugin-sdk/index.d.ts" />

// Netrc file -- a secret-source-only extension: nothing renders on the
// board, so activate registers nothing. The source lives in secrets.js,
// which Mill runs on its own side, never in the page.
export function activate() {}
