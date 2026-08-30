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

## Drawing tools

A plugin isn't limited to click-to-place objects: it can register a
DRAG tool that rides the same gesture engine, style picker, and
live-preview overlay Mill's own drawing tools use — in fact Mill's
own pencil, shape, eraser, and laser ARE such a plugin (**Drawing**,
built into the app; its row sits under Installed plugins, and a
folder named `mill-drawing` in your plugins folder replaces it). The
declaration fields that open this up:

- `interaction` — `"arm-then-click"` (the default), `"drag-to-draw"`
  (the armed pointer drag feeds your `gesture`, which decides what to
  create), or `"ephemeral-drag"` (the drag only renders a live
  preview and never creates anything — a laser-pointer shape;
  `renderFace` is optional there, since nothing is ever placed).
- `styleFields` — the tool's styleable properties (`color`,
  `color-or-none`, `stroke-width`, and `shape-kind`, an icon-button
  picker whose options name their icons from the same named glyph set
  as `icon` below), each with its own options, default, and optional
  `label`. Declaring any renders Mill's style picker next to the
  armed tool automatically; current values arrive on the gesture ctx.
- `gesture` — `{ onPoint?, onEnd, renderPreview?, fadeMs? }`. `onEnd`
  receives the full drag's points plus a ctx carrying
  `screenToFlowPosition`, `styleValues`, `createObject(payload,
  flowPos, opts?)` (scoped to your own kind; lands, syncs, and undoes
  like any placement — `opts.size` sets the placed size, `opts.select`
  selects it), and `saveImageBytes(base64, ext, title)` for baking
  drawn bytes into a Mill-owned file a file-backed object's payload
  can point at. `renderPreview(el, points, now)` draws the live
  in-drag stroke into a host-owned overlay element. Drag tools stay
  armed across strokes by default (`sticky: false` opts out, and a
  non-sticky tool may add `lockable: true` so re-clicking its armed
  button locks it for deliberate repetition).
- Identity extras — `icon` takes an emoji or a named glyph (`pencil`,
  `zap`, `trash`, `diamond`, `square`, `circle`, `arrow-up-right`);
  `shortcutKey` gives the tool a bare-letter shortcut and tray key
  chip; `group: "annotate"` files its button into the tray's Annotate
  drawer; `objectKind` lets the persisted object kind differ from the
  tool id (the pencil places `ink` objects); `dragBand: false` drops
  the drag-handle band when the object's whole body already drags.
- Erasing — a tool that erases instead of creating declares the
  `erase-board-items` capability in its manifest. Its gesture ctx
  then carries `eraseHitTest(pt)` (accumulates whatever board item
  sits under the point) and `commitErase()` (erases the accumulated
  set through the same undoable quick-delete a Delete key press
  uses — one undo step per pass). What was hit stays on Mill's side;
  the plugin never sees item identities.

## The example plugins

Mill's repository ships two working examples: **Bookmark**
(`examples/plugins/mill-bookmark`) — a web address pinned to the
board, edited in place, opened through a guarded ask — and
**Scribble** (`examples/plugins/mill-scribble`) — a freehand drawing
tool exercising the drag interaction, style fields, and live preview
above. Copy either folder into your plugins folder to try it, or use
it as the starting point for your own.

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
