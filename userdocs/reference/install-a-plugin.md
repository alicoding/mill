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

## Before a plugin runs

A plugin you install after Mill first ran with this check waits for
your review: Settings > Extensions lists it with what it can request,
which hosts it can reach, and what it catches, and nothing of it runs
until you click **Allow** and reload. A notice in the footer tells you
when one is waiting. Plugins that were already installed when the
check arrived keep running; only new arrivals wait.

Mill remembers what you allowed: the plugin's files are fingerprinted
at that moment, and if they change later — an update you copied in,
or an edit — the plugin stops until you look again and allow it once
more. The row says "Its files changed since you allowed it."

An administrator can pin which plugins may run at all by writing an
allow-list into Mill's settings file — the key
`settings-plugin-allowlist`, a JSON array of plugin ids, placed the
way device-management tooling places any managed setting. When it is
set, Settings > Extensions reports it and every plugin off the list
shows as blocked, with no way to turn it on from the app. The Drawing
plugin built into Mill is exempt.

An administrator can also require signatures: the key
`settings-plugin-signing-keys`, a JSON array of minisign public keys.
With keys pinned, a plugin runs only when its folder holds
`mill-plugin.minisig`, a minisign signature of the folder's content
hash (Export plugin audit shows each plugin's `contentHash`; sign that
string with `minisign -S`). Unsigned plugins show as such and cannot be
turned on.

**Export plugin audit** (Settings > Extensions, or the command
palette) saves one JSON file: every installed plugin with its declared
reach and whether it is allowed and on, every action a plugin asked
Mill to perform within the last day, and every secret a plugin read.

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

When two plugins claim pasted links (Bookmark and the Web clipper both
do), the first one lands and the board's toast offers the other:
"Pasted as Bookmark · Paste as Web clipper instead" re-types that same
object in place, undo included. Settings > Extensions' "Pasted links
become" picks which one lands first; without a choice, plugins take
turns in id order.

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

## Settings

A plugin declares its own settings in the manifest, and Mill does the
rest: the controls render inside the plugin's row under Installed
plugins, the values are stored centrally, and the plugin reads them
back through `api.settings`. A plugin never builds a settings screen.

```json
"contributes": {
  "settings": [
    { "key": "titleStyle", "type": "enum", "label": "Title",
      "description": "What a bookmark shows as its title.",
      "default": "hostname",
      "options": [
        { "value": "hostname", "label": "Site name" },
        { "value": "address", "label": "Full address" }
      ] },
    { "key": "placeholderTitle", "type": "string",
      "label": "Title before an address", "default": "Bookmark" }
  ]
}
```

Five types: `boolean` (a checkbox), `string` (a text field),
`number` (a number field, with optional `min` and `max`), `enum`
(a dropdown over `options`), and `secretRef` (a picker over the
vault's entries — see below). `default` is the value in effect until
the user changes the control; a mistyped manifest — a default of the
wrong type, an enum default missing from its options, a default on a
`secretRef` — blocks the plugin from loading and names the key in its
row.

A `secretRef` setting names a credential without ever holding it:

```json
{ "key": "auth", "type": "secretRef", "label": "Authorization",
  "description": "Sent as a bearer token with every request." }
```

The user picks one of their vault entries in the plugin's row; the
stored value is a reference, and `api.settings.get('auth')` answers
the entry's title (or an empty string when nothing is picked). The
value itself only ever travels inside `api.fetch` — see Reaching the
network. A picked entry that is later deleted shows "This secret no
longer exists. Pick another." in the row, and a request naming it is
refused with the same words.

```js
export function activate(api) {
  const style = api.settings.get('titleStyle')        // 'hostname' | 'address'
  const stop = api.settings.onChange('titleStyle', (next) => {
    // Redraw whatever depends on it -- a face only re-renders on its
    // own data changes, so this is the door for a settings change.
  })
}
```

Commands a plugin registers can carry `enabled: () => boolean`, the
same state check built-in commands use; a disabled command is left
out of the palette rather than shown doing nothing. A default
keyboard shortcut is not something a plugin ships — the user assigns
one under Keyboard shortcuts.

## Notices

A plugin tells the user something through Mill's own notice pill in
the footer, labelled with the plugin's name. Info and success notices
leave on their own after a few seconds; warnings and errors stay until
dismissed. A user-started action that fails should always say so here,
never only in the console.

```js
const dismiss = api.notify({ level: 'error', text: 'Could not save the bookmark address.' })
// Optional: a secondary link running one of this plugin's own commands.
api.notify({ text: 'Imported 12 rows.', action: { label: 'Show', commandId: 'showImport' } })
```

## Storage

A plugin keeps its own state in `api.storage`, saved centrally under
the plugin's id: any JSON value, read synchronously, written through
on `set`. Nothing else in Mill reads it. The Drawing plugin uses it to
remember the last-used pencil and shape style across restarts.

```js
const saved = api.storage.get('pencil') || {}          // undefined when never set
await api.storage.set('pencil', { color, size })
await api.storage.delete('pencil')
api.storage.keys()                                      // ['pencil', …]
```
## Reading the board

A plugin lists what is on the board through `api.query`, and hears
about changes through `api.on`. Every entry carries the name a person
sees it by: a card's title, a note's first line, an object's title or
kind. Cards, notes, and every object kind — built-in or another
plugin's — come back the same shape.

```js
const notes = await api.query({ kind: 'note' })        // [{ id, kind, title, parentId, position, size, payload }]
const everything = await api.query({})
const children = await api.query({ parentId: someCardId })

const stop = api.on('contents:changed', ({ id }) => {
  // Something on the board was created, edited, moved, or deleted.
  // A face only re-renders on its own data, so re-list here.
})
```

The Board index example (`examples/plugins/mill-index`) is exactly
this: one object whose face lists the board by kind and re-renders
on every change.

## Reaching the network

A plugin never opens a connection itself. It declares the hosts it
needs in the manifest, asks Mill to fetch, and Mill decides through
your guardrail rules — allow, ask you first, or deny — the same way it
decides an agent's write. Approved requests run inside Mill, confined
to the declared host on every hop (a redirect elsewhere is refused),
and the response comes back to the plugin. A host or method the
manifest does not declare is refused before any rule runs.

```json
"capabilities": ["fetch"],
"contributes": {
  "network": [
    { "host": "api.example.com" },
    { "host": "hooks.example.com", "methods": ["GET", "POST"] }
  ]
}
```

An entry without `methods` allows GET only. Responses are capped at
4 MB. A plugin whose hosts are typed by the user — a request tester,
say — declares `{ "host": "*" }`: every request to a host not
otherwise declared then asks you first, every time, and no rule can
make it silent. The Extensions row says so before the plugin runs.

```js
const res = await api.fetch('https://api.example.com/issues?open=1')
if (res.approved) console.log(res.status, res.body)   // headers in res.headers
else api.notify({ level: 'warning', text: 'Not allowed' + (res.ruleLabel ? ' (' + res.ruleLabel + ')' : '') })
```

Credentials belong in the vault, not in plugin code. A request that
needs one names a `secretRef` setting, and Mill attaches the entry's
value itself — after you approve the request — as a header:

```js
const res = await api.fetch('https://api.example.com/me', {
  secret: { settingKey: 'auth' }                 // Authorization: Bearer <value>
  // or: secret: { settingKey: 'auth', header: 'X-Api-Key', prefix: '' }
})
```

Every request that carries a secret asks you first, whatever your
other rules say: the Review row reads "GET api.example.com · uses
secret ‘Jira PAT’", and the vault's access history records the read
as sent by the extension. The value is redacted from the response
before the plugin sees it — a server echoing the token back gets
`[redacted]`.

## Writing to the board

A plugin creates notes and cards, updates cards, and adds rows to a
List through the same guarded door an agent uses: each write goes to
your guardrail rules — allow, ask you first in Review, or deny — with
the plugin named as the source, and lands with its own undo history.
The manifest declares the capability; without it every write is
refused before any rule runs.

```json
"capabilities": ["write-content"]
```

```js
const note = await api.content.createNote({ text: 'Call the bank\ntomorrow', parentId })
const card = await api.content.createCard({ kindId, title: 'Acme', fields: { status: 'active' } })
await api.content.updateCard(card.id, { note: 'Renewal due in March' })
await api.content.appendListRow(listId, { vendor: 'Acme', tier: 'gold' })
if (!note.approved) api.notify({ level: 'warning', text: 'Not allowed' + (note.ruleLabel ? ' (' + note.ruleLabel + ')' : '') })
```

A note without a position lands just right of the last item in its
parent. A denied write resolves with `approved: false`; an approved
one carries the new entity's `id`.

## Workflow steps

A plugin can add steps to the workflow palette. Declare them in the
manifest and implement them in a `steps.js` next to `main.js`:

```json
"contributes": {
  "steps": [
    { "id": "text-case", "label": "Text case", "description": "Changes the text's case.",
      "config": [ { "key": "mode", "label": "Mode", "type": "options", "options": ["upper", "lower", "title"], "default": "upper" } ] }
  ]
}
```

```js
// steps.js -- plain script, no imports or exports
registerStep('text-case', {
  perform: function (input) {
    // input.payload: the text arriving from the previous step
    // input.config: this step's authored fields (input.config.mode)
    // input.attributes: the run's attribute values
    return input.payload.toUpperCase()          // or { payload, attributes }
  },
})
```

`steps.js` runs inside Mill's workflow engine, not in the window: a
step works in a scheduled or headless run exactly as it does from the
editor, and Try this step in the Inspector runs the same function. It
sees only its input — no network, no files, no other plugin — and a
step that runs longer than a few seconds fails the run instead of
hanging it. Config fields are text or a fixed option list. The step
appears in the palette under Transform as "<label>", and the
Extensions row lists "Adds workflow steps". The **Text case** example
(`examples/plugins/mill-textcase`) is the whole pattern in one file.

## Captures

A plugin can offer a quick capture: a small face that opens in its own
floating window from the Quick Panel or the command palette, away from
the canvas, and lands what the user writes where they choose. Declare
it in the manifest and register the face:

```json
"contributes": { "captures": [ { "id": "thought", "label": "Thought", "description": "A one-line thought." } ] }
```

```js
api.registerCapture({
  id: 'thought',
  render(el, ctx) {
    // Draw the face into el. ctx.destinationId is the card the user
    // chose in the window's header ("" for the top level) -- pass it
    // as parentId to a content door, then call ctx.done().
    // ctx.cancel() closes without writing.
  },
})
```

The Quick Panel lists "New <label>…" straight off the manifest, so the
row is there before any plugin code runs; the capture window loads the
plugin and calls `render`. Writes go through the same guarded content
doors as everywhere else. Mill's own note is the first capture (the
"New note…" row); the destination is remembered per capture.

## Views

A plugin can own a work tab — the same strip a workflow editor opens
in. Declare the view in the manifest (its title is the tab's label,
and the Extensions row lists it), register how to draw it when the
plugin activates, and it appears in the command palette under that
title. The panel keeps what you drew while another tab is in front;
after Mill restarts, the tab comes back and draws again.

```json
"contributes": { "views": [{ "id": "issues", "title": "Issues" }] }
```

```js
export function activate(api) {
  api.registerView({ id: 'issues', render(el, ctx) {
    el.replaceChildren()            // plain DOM, same as renderFace
    // ... list issues here; api.query / api.fetch / api.storage all work
  } })
}
```

Your own commands can open it too: run the registry command
`view.open.<plugin id>.issues`.

## Context-menu items

A plugin can add items to the right-click menu of its own objects.
Each item acts on the object that was clicked and receives the same
context the face gets; an item can say when it applies, and Mill leaves
it out of the menu until then. Other kinds of object never show it.

```js
api.registerCanvasObject({
  kind: 'bookmark',
  menuItems: [
    { id: 'open', label: 'Open in browser',
      enabled: (ctx) => !!ctx.object.Payload.url,
      run: (ctx) => ctx.requestGuardedAction('open-url', { url: ctx.object.Payload.url }, 'Open the bookmark') },
  ],
  // ...
})
```

## The example plugins

Mill's repository ships six working examples: **Bookmark**
(`examples/plugins/mill-bookmark`) — a web address pinned to the
board, edited in place, opened through a guarded ask, with two
declared settings — **Scribble** (`examples/plugins/mill-scribble`) —
a freehand drawing tool exercising the drag interaction, style fields,
and live preview above — and **Board index**
(`examples/plugins/mill-index`) — a live listing of the board through
`api.query` and `api.on` — and **Request tester**
(`examples/plugins/mill-request-tester`), a real tool on nothing but
the doors: a work tab, any-host guarded fetch, a storage-backed
history, and a declared setting — and **Mind map**
(`examples/plugins/mill-markmap`), a view over a note's headings that
follows the note as it changes, its rendering engine vendored as one
committed bundle (`scripts/vendor-markmap.sh`) so it never loads
anything from the network — and **Web clipper**
(`examples/plugins/mill-clipper`), which fetches a page through the
guarded network door, extracts the article with Mozilla's Readability
(vendored the same way), converts it through the SDK's convert door
(`api.convert.htmlToMarkdown`), and saves it as a note through the
guarded content door. Copy any folder into your plugins
folder to try it, or use it as the starting point for your own.

## Checking a plugin

Two commands run the same checks Mill's own examples pass:

```sh
go run ./internal/pluginconform path/to/your-plugin   # the loader's rules, ahead of time
cd frontend && npm run plugin:conform                 # activates every example against a recording host
```

The first refuses what the loader would refuse — id and folder name,
capabilities, contributions, file types the plugin route serves, a
symlink leaving the folder. The second activates each plugin against a
recording stand-in for `api` and checks that every object, view, and
setting it registers or reads is declared in its manifest.

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

`el` is scaled with the board: zoom out and every pixel inside it
shrinks. Plain DOM does not care, but a rendering engine that measures
its own labels or fits a layout from screen rectangles (a mind map, a
graph layout, a text-measuring chart) lays out wrong inside a scaled
box. For those, `ctx.mountOffBoard(element, { w, h })` parks your
element off the board at exactly that size, unscaled; render there,
copy the finished drawing into `el`, then call the detach it returned.
The Mind map example does exactly this on every repaint, and Mill
detaches anything you left mounted when the object leaves the board.

The full contract — every field, every capability, and what stays
stable between versions — is in [Extending the canvas](extending-the-canvas.md).
