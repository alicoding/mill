---
kind: how-to
---

# Port an extension from another platform

This guide names VS Code because its manifest vocabulary is the one
Mill's own manifest deliberately reads close to. The pattern applies
just as well coming from any extension platform: some portable logic
can be reused, while calls into another platform's host need an adapter
or a Mill implementation. No other platform's extension host runs
inside Mill.

## How much of an extension actually ports

Classify each piece of what you are bringing over before you start
rewriting anything:

1. **Pure data, no runtime port** — a settings schema or color theme is
   plain JSON with nothing running behind it. Compatible declarations
   can move into a Mill manifest. A standalone color-theme file can go
   through **Extensions > Import theme**, where Mill maps the interface
   colors it understands and reports which source keys it used.
2. **A declared field with code behind it** — a command, a
   configuration entry — the field NAME maps across, but the function
   that runs when it fires does not exist on this platform. You write
   that function against Mill's own plugin API; the manifest only
   tells Mill the function exists and what it is called.
3. **Logic with no declarative shape at all** — parsing a file format
   or rendering a live-editing surface has nothing to map in the
   manifest. Portable parsing or transformation logic may be reused;
   integration with the editor, storage, network, or interface uses
   Mill's SDK and guarded host calls.
4. **No plugin at all** — sometimes an extension's entire job reduces
   to "call one API with these saved settings." That is a Configure
   entity plus a workflow step, not an extension, on either platform.

## Field by field

| Source field | Mill field | Treatment | Why |
| --- | --- | --- | --- |
| `contributes.configuration` | `contributes.configuration` | Accepted as-is | Same shape: a typed setting with a default and a description. |
| `contributes.commands` | `contributes.commands` | Accepted as-is | Same shape: an id and a label. The function it runs is rewritten (see below). |
| `contributes.menus` | `contributes.menus` | Mapped | Foreign menu ids land on the Mill surface that plays the same role — see the seat table below. An id with no equivalent is accepted and ignored, never a load failure. |
| `contributes.views` | `contributes.views` | Mapped, narrower | Both declare an id, a title, and where the page's own code lives; Mill has no nested view-container tree — every view is a flat work tab. |
| `contributes.viewsContainers` | — | Not supported | Mill's own chrome (the sidebar's fixed sections) is not a plugin-extensible tree; a view still declares which existing tab it opens in. |
| `contributes.themes` | `contributes.themes` | Adapted | Mill themes are CSS token declarations. Importing a standalone JSON/JSONC color theme maps a fixed set of interface colors, keeps all other colors at Mill defaults, and does not import syntax highlighting. |
| `activationEvents` | — | Not supported, by design | Mill activates every enabled extension at boot, always. There is no lazy-activation contract to port; see below. |
| `keybindings` | — | Not supported, by design | Mill never ships a default hotkey with an extension; the person using Mill binds their own in Settings. See below. |
| `contributes.languages` / `grammars` | — | Not supported | Mill has no text-editor surface an extension can extend syntax highlighting inside. |
| `contributes.debuggers` / `taskDefinitions` | — | Not supported | No matching surface exists in Mill today. |

### Menu ids and Mill's seats

| Source menu id | Mill seat |
| --- | --- |
| `commandPalette` | Already true for every command Mill knows about; declaring it does nothing extra. |
| `editor/context` | The canvas object's own right-click menu. |
| `view/title` | The work tab's title area. |
| any other id | Accepted and ignored — named once in the extension's status so you know it was silently dropped, never a load failure. |

## Three ported jobs, classified

- **A request-and-response extension** (send an HTTP request, apply
  saved headers and a timeout, show the response): its settings and
  its command are field 2 above — the names carry over, the send/parse/
  render logic is written fresh against Mill's own guarded fetch and
  output viewer. Mill ships exactly this rewrite as one of its own
  bundled examples, so you can read a finished one rather than
  starting from a blank file.
- **A single command with no interface of its own**, whose entire job
  is "call this one API using a saved setting": this is field 4 —
  build a Configure connector entity and a workflow step instead of an
  extension. Nothing about it needs plugin code on either platform.
- **A plugin whose whole job is reformatting text live inside another
  app's own text editor**, with full access to that editor's internal
  state: there is no equivalent surface to extend inside Mill, so
  nothing here maps or ports. If the underlying job is spreadsheet- or
  table-shaped, check whether Mill's own sheet object already covers
  it before writing anything.

## What stays deliberately absent

**Keybindings.** Mill never ships a default hotkey for anything it
runs, extensions included — every shortcut in Mill is bound by the
person using it, in Settings, and an extension's own commands bind the
same way. Bringing over a suggested keybinding would be the one thing
in the whole manifest that quietly overrides someone's own keyboard,
so it is left out on purpose.

**Lazy activation.** Some platforms only start an extension once its
declared trigger fires (opening a matching file, running its command
for the first time). Mill activates every enabled extension once, at
boot, and keeps it running — there is no partial-boot state for a
manifest to declare into, so `activationEvents` has nothing to map
onto.

## What the code side is reauthored against

Whichever surface the extension's code targeted, the replacement is
written against one of three doors, never a copy of the original
runtime:

- **`activate(api)`** — the entry point every extension's `main.js`
  exports, receiving the one object every capability arrives through
  (registering commands, views, canvas objects, reading settings,
  making a guarded request).
- **A declared script module** (`steps.js`, `secrets.js`) — for a
  workflow step or a secret source the extension contributes, run in
  Mill's own sandboxed engine rather than the extension's own process.
- **A framed entry page** — for a view, a capture, or a canvas
  object's own face, an ordinary HTML/JS page mounted in its own
  sandbox, talking back to Mill only through the same `api` handle.
