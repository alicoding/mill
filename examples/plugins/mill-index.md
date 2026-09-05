# Board index

Lists everything on the board by kind, and keeps the list current as
the board changes. Its Refresh command is also reachable by an agent
over MCP, so a person and an agent list the board the same way.

Two surfaces, two forms. The canvas object draws its face into Mill's
own document. The Board contents tab is an entry page: `view.html` and
`view.js` are the plugin's own page, mounted in a sandboxed frame,
reaching Mill only through `window.acquireMillApi()`. Open it from the
command palette.

## Settings

None.

## Capabilities

None.

## Try it

Copy the `mill-index` folder into Mill's plugins folder (Settings >
Extensions > Open plugins folder) and reload plugins. Place a Board
index object anywhere on the board, then open Board contents from the
command palette to see the same listing as a page of its own.
