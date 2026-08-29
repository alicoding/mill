# Install a plugin

A plugin adds a new object type to the canvas without rebuilding Mill.
It is a folder holding two files — `manifest.json` (name, version, and
what the plugin is allowed to ask for) and `main.js` (its code) — and
installing one is copying that folder into Mill's plugins folder.

## Installing

1. Open **Settings → Extensions** and press **Open plugins folder**.
2. Copy the plugin's folder in — the folder name must match the
   plugin's id.
3. Press **Reload**. The plugin's tool appears in the canvas tray, and
   its row appears under **Installed plugins** with its name, version,
   author, and what it can request.

A plugin that can't load shows exactly why on its row — a missing
file, invalid manifest, or a capability Mill doesn't recognize —
instead of silently doing nothing. A plugin whose manifest sets
`minMillVersion` to a version newer than your Mill is refused the
same visible way: update Mill, then reload.

## Turning a plugin off

Each installed plugin has the same switch every built-in extension
has. Turning it off removes its tool from the tray and palette;
objects it already placed stay on your boards untouched.

## What a plugin can and cannot do

A plugin draws its own objects and edits their data through Mill.
It is never handed the ability to open network connections, touch
files, or leave the app on its own. When it needs something like
that — opening a web address in your browser, say — it must:

1. **Declare** the capability in its manifest, visible on its
   Extensions row before you ever run it.
2. **Ask** at the moment of use. Every ask runs through your
   guardrail rules: you can allow it, deny it, or leave the default,
   which parks the request in **Review** for your explicit approval.

Undeclared asks are refused outright. Approved actions are performed
by Mill itself, never by the plugin's own code.

## Catching drops and pastes

A plugin can claim the two ways outside content lands on the board:
a file dragged in from your file manager, and content pasted from
another app. Claims are declared in the manifest, so the Extensions
row shows what a plugin catches before it ever runs:

```json
"contributes": {
  "canvasObjects": [
    { "kind": "bookmark", "pastesURLs": true, "fileExtensions": [".webloc"] }
  ]
}
```

- `fileExtensions` — dropped files with a listed extension land as
  this plugin's object, pointing at the file where it is. Requires
  `source: "file"` on the registered object.
- `pastesURLs` — a web address pasted from any app lands as this
  plugin's object instead of a note. Requires `source: "url"`.

Mill's own built-in shapes always win first — a diagram, image, or
spreadsheet file keeps landing as its built-in object — and anything
no one claims still lands the way it does today. With the Bookmark
example installed, pasting a link from your browser drops a bookmark
right on the board.

## The example plugin

Mill's repository ships a working example, **Bookmark** — a web
address pinned to the board, edited in place, opened through a
guarded ask. Copy `examples/plugins/mill-bookmark` from the
repository into your plugins folder to try it, or use it as the
starting point for your own.

## Writing one

A plugin's `main.js` is a plain JavaScript module — no build step —
exporting one function:

```js
export function activate(api) {
  api.registerCanvasObject({
    kind: 'my-thing',
    label: 'My thing',
    icon: '⭐',
    source: 'board-local',
    editRoute: 'inline',
    defaultPayload: {},
    renderFace(el, ctx) {
      // Draw into el with plain DOM. ctx.object holds the data;
      // ctx.updatePayload(patch) saves changes (undo included);
      // ctx.requestGuardedAction(kind, attrs, description) asks Mill
      // to act on the plugin's behalf.
    },
  })
}
```

The full contract — every field, every capability, and what stays
stable between versions — is in [Extending the canvas](extending-the-canvas.md).
