# Extending the canvas

Add one file under `frontend/src/atlas/tools/` and rebuild, and Atlas
has a new placeable tool — card, note, area, table, and image all work
exactly this way today, five self-registered files. (The drawing
tools — pencil, eraser, laser, shape — used to as well; they now ship
as the bundled Drawing runtime plugin, registered through the same
plugin door you can use.) This page is the contract that file has to
satisfy: how it gets discovered, what its declaration requires, and
which platform services its runtime code may call — and may not.

Two doors exist now. A **runtime plugin** — a folder with a manifest
and a `main.js`, copied into the app's plugins folder, no rebuild —
is the out-of-tree door, and [Install a plugin](install-a-plugin.md)
covers it end to end, including the `activate(api)` contract, drag
tools with style pickers and live previews, and the
guarded-capability model; [Plugin theming](plugin-theming.md) is how
whatever you draw follows the reader's color scheme. This page is the OTHER door: a compiled-in
tool built by editing Mill's own tree, the same way adding a workflow
step type does — fuller reach (custom React rendering, and any
platform hook the plugin surface doesn't carry yet) at the price of a
rebuild. The "Stability" section
below says exactly what is and isn't safe to build against either
way.

## How it loads

A canvas tool is one file, `frontend/src/atlas/tools/<id>Tool.ts`,
that:

1. Builds an object matching the `AtlasToolShape` type
   (`frontend/src/atlas/atlasNounRegistry.ts`).
2. Calls `registerNoun(thatObject)` at module scope — not inside a
   function, not conditionally. The call has to run the moment the
   module loads.

`frontend/src/atlas/atlasTools.ts` discovers every file matching
`tools/*.ts` via `import.meta.glob(..., { eager: true })` — a glob
over the filesystem, not a hand-maintained list a new tool has to be
appended to. `registerNoun()` throws immediately if two files claim
the same `id`, and a startup check
(`assertRegistryAgreesWithIdentity()`) fails hard if a tool has an
identity (`frontend/src/shared/atlasToolIdentity.ts`) but no
registered descriptor, or a descriptor but no identity — a half-wired
tool cannot exist silently.

A tool's own translated strings follow the same shape, one level down:
`frontend/src/locales/en/atlas/<id>.json` is merged into the single
`atlas` i18next namespace by `frontend/src/app/atlasLocaleMerge.ts`,
discovered the same glob-and-merge way. The merge refuses two files
declaring the same top-level key, so a new tool's own locale file can
never silently clobber another tool's strings.

**The declaration-vs-code split.** `AtlasToolShape` splits into inert
data, read before any of the tool's own code runs, and one runtime
function. Naming the split explicitly is what lets the registry get
checked and documented as data, table below included:

- **Inert declaration** — read before any of this tool's own code
  runs, and enumerable purely as data: `id`, `icon`, `label`,
  `shortcutKey`, `tray`, `interaction`, `styleDefaults`,
  `styleFields`, `lockable`, `resizable`, `boardNodeType`,
  `dragBand`. The whole "What is required" table below is this list.
- **Runtime code** — the one member that's a function, not data:
  `commit`, which shapes this tool's own placement input into the
  artifact the board persists.

## What is required

Every field on `AtlasToolShape` other than `commit` (documented above
as the one runtime-code member) is REQUIRED — never optional, never
inferred — so a tool that omits one fails to compile rather than
half-existing. `false`, `null`, and an empty array are legitimate,
honest answers for a field that doesn't apply to a given tool; they
are never omissions.

<!-- BEGIN GENERATED: noun declaration fields (source: frontend/src/atlas/atlasNounDeclarationFields.json) -->

| Field | Legal values | Meaning |
|---|---|---|
| `id` | one of the ids declared in shared/atlasToolIdentity.ts's ATLAS_TOOL_IDENTITIES array | the noun's stable identity. registerNoun() throws at module-eval time on a duplicate; assertRegistryAgreesWithIdentity() fails the build if an identity has no matching descriptor, or a descriptor has no matching identity. |
| `icon` | any icon component from @primer/octicons-react, typed as Icon | the glyph rendered on this noun's tray/palette button. |
| `label` | a string | the button/command text. By convention every in-tree noun sources this from identityOf(id).commandLabel rather than restating it, but the field itself accepts any string. NEVER read as this noun's row title in Settings > Extensions — see nounName below. |
| `nounName` | a string | the bare noun a user would call this thing ("Card", "Pencil"), read only by Settings > Extensions' row title. Kept separate from label because label is a command verb phrase ("Add a card") and a row title needs the noun, not the verb. |
| `description` | a string, or omitted entirely | a one-sentence, user-vocabulary summary of what this noun does. Read by Settings > Extensions' per-row disclosure; a noun that omits it falls back to its own label there. |
| `shortcutKey` | a single-character string, or null | the bare keypress that arms this tool from the board. null for a tool with no bare-key shortcut. |
| `tray` | 'quick' or 'palette' | which tray surface renders this tool's button. |
| `group` | 'knowledge', 'file', or 'annotate' — REQUIRED, never optional | which tray cluster this noun's own button renders in. AtlasCreationTray.tsx's TRAY_GROUP_ORDER renders 'knowledge' and 'file' flat, primary-first; 'annotate' tools collapse into the tray's one expandable Annotate group instead of rendering flat. |
| `settings` | an array of {type, key, label, description, defaultValue} setting declarations — type is boolean | string (optional placeholder) | number (optional min/max/step) | enum (options: [{value, label}]) — or omitted entirely | the noun's own user settings (goal 0258): declared here, rendered generically inside its Settings > Extensions row, persisted centrally per extension id + key. defaultValue applies whenever the user has never touched the control; a stored value of the wrong type, or an enum value no longer among the options, falls back to it. Omitted means the row shows no settings block. A runtime plugin declares the same shape as manifest contributes.settings and reads it back through api.settings. |
| `interaction` | 'arm-then-click', 'pick-then-place', 'drag-to-draw', 'drag-to-erase', 'ephemeral-drag', or 'paste-or-drop' | the authoring gesture that places this noun. Must equal the same field on this id's own shared/atlasToolIdentity.ts entry — the registry's own agreement check cross-validates the two so they can never silently drift apart. |
| `styleDefaults` | a record of style-field key to value, or omitted entirely | session-only seed values for a freshly placed instance's style state (colour, size, ...). Never persisted document data — omit this field for a noun with no style surface rather than declaring an empty object. |
| `styleFields` | a readonly array of AtlasStyleField entries (atlasStyleVocabulary.ts's closed union: color, color-or-none, stroke-width, or shape-kind) — REQUIRED, never optional | this noun's own declared styleable properties. An empty array is the honest answer for a noun with no style surface at all. A non-empty array makes AtlasStylePanel.tsx render this tool's style picker automatically — no other file needs to name this noun's id. |
| `lockable` | boolean — REQUIRED, never optional | does re-clicking this tool's own already-armed tray button lock it for repeated placement, instead of disarming on the second click? Only meaningful for an arm-then-click tool; every other tool still declares it, always false. |
| `resizable` | boolean — REQUIRED, never optional | can a placed instance be dragged to a new size via the shared NodeResizer? A container that auto-fits its own children, or a tool that never persists a placed instance, both legitimately declare false. The conformance suite checks that a true answer is backed by a real `<NodeResizer>` in the renderer boardNodeType names. |
| `boardNodeType` | 'atlas-note', 'atlas-sticky', 'atlas-group', 'atlas-object', or null | which shared React Flow node component renders this noun's placed instance. null for a tool whose gesture never persists a renderable instance (eraser, laser). |
| `dragBand` | boolean — REQUIRED, never optional | only load-bearing when boardNodeType is 'atlas-object': does this noun's own content capture pointer events (a grid, a vendored pan/zoom viewer), so the shared renderer needs to add its own chrome band as the drag surface? A noun whose whole body already drags declares false, not omitted. |
| `boardObjectKind` | 'shape', 'image', 'ink', 'table', 'diagram', 'sheet', or null | the persisted BoardObject.Kind this noun's own placed instance carries, or null for a tool that never routes through the shared 'atlas-object' renderer. Not always equal to id — pencil's own placed instance is Kind 'ink' — so content resolution below keys off this field, read from object.Kind, never off id. |
| `content` | an object with Component (a React component accepting { object, mirrorVersion }), ariaLabelKey (a string), and role ('img' or undefined), plus the optional members source, editRoute, clickShield, wheelContained, overflowChip and extension — or null | this noun's own placed-instance content contribution. registerNoun() feeds it into the board-object content registry (atlasNounRegistry.ts's registerBoardObjectContent) whenever boardObjectKind is non-null, killing AtlasBoardObjectNode.tsx's former per-Kind hand branch. A tool-less noun (diagram, sheet) calls registerBoardObjectContent directly instead of declaring this field at all, since it has no AtlasToolShape to satisfy — it instead sets this same content shape's own optional `extension` member (icon, label, description, disableScopeNote, group) so Settings > Extensions can still render an honest, correctly-sectioned row for it. mirrorVersion bumps on a live disk change to a fileBacked Kind's own mirrored file (see fileBacked below) — a non-file-backed Component simply ignores it. clickShield (a face that owns its own pointer model: an embedded viewer, or a grid that would otherwise read a bare click as a cell click) shields the face until the object is selected, so the first click always selects the object; wheelContained keeps the board from panning (and the object from being dragged) while such a face is live and consuming the pointer itself; overflowChip lets the shared chrome band carry a “Fit” chip whenever the face reports its content is larger than the object's box. |
| `capabilities` | a readonly array of strings, or omitted entirely | the external reach this noun's own manifest declares. No current noun sets it. Settings > Extensions' reach line reads this field directly, so a future noun's declared capabilities show up there with no other code change. |
| `fileBacked` | boolean — REQUIRED, never optional | does this noun's own placed instance read Payload.mirrorPath as a real external file (goal 0232's file-backed preview/open/watch contract)? true gets the shared live-watch subscription (its own content Component sees mirrorVersion bump) and the object.openInDefaultApp context-menu command uniformly, with no extra wiring of either. A noun with no boardObjectKind at all still declares it, always false. |
| `sticky` | boolean — REQUIRED, never optional | does this tool stay armed after a completed gesture (pencil/eraser/laser — repeated strokes/passes are the point), or disarm after one? useAtlasToolGesture.ts reads this to decide whether a gesture's own onEnd may call ctx.disarm/disarmUnlessLocked at all — a sticky tool gets no-ops for both. A non-drag tool still declares it, always false. |
| `gesture` | an object with onEnd (a function), plus optional onPoint/preview/fadeMs — or null | a drag-shaped tool's own pure behavior contribution to the ONE platform gesture engine (useAtlasToolGesture.ts): onEnd commits (or no-ops); onPoint accumulates live per-point state (eraser's own hit-testing); preview is a component rendered generically in one overlay slot; fadeMs makes an ephemeral tool's own points age out on a timer instead of clearing at pointerup. null for every tool whose interaction never drags. |

<!-- END GENERATED -->

**Your declaration must pass the conformance suite — it IS the
contract test**, the same way a compiler is the contract test for a
type. A new or changed tool has to keep these files passing:

- `frontend/src/atlas/atlasNounDeclarationFields.test.ts` — this
  page's own table stays exhaustive against the real `AtlasToolShape`
  type.
- `frontend/src/atlas/atlasArmConformance.test.ts` — a tool's
  `lockable` answer matches its actual arm/disarm behavior.
- `frontend/src/atlas/atlasBoardSurfaceConformance.test.ts` — a
  `resizable: true` answer is backed by a real `NodeResizer` in the
  renderer its `boardNodeType` names; a `boardNodeType: 'atlas-object'`
  tool keeps the shared drag frame band wired; the drag band is gated
  on `dragBand`, never rendered unconditionally; and two specific
  shared files (`AtlasCreationTray.tsx`, `AtlasStylePanel.tsx`) contain
  no tool-id branch.
- `frontend/src/atlas/atlasEditorBoundsConformance.test.ts` and
  `atlasSelectionRingConformance.test.ts` — the shared editor-bounds
  and selection-ring surfaces reach every registered tool, not a
  hand-picked subset.

None of these render anything — they read source files and the live
registry as data and assert against it (this repo's own
"static source-audit" pattern, documented in each test file's header).
A tool that satisfies the type checker and these tests is, by
definition, correctly wired.

## What platform APIs exist — and what you may not reach

A tool's own `commit` function, and any board-rendering code it needs
(shared node renderers, not the tool file itself — see "inherits for
free" below), may call:

- **Board object CRUD** — `AtlasService.CreateBoardObject`,
  `SetBoardObjectSize`, `SetBoardObjectPosition`, `MoveBoardObject`,
  `DeleteBoardObject`, `Objects` (generated bindings at
  `frontend/bindings/.../internal/services/atlassvc/atlasservice.ts`).
- **Mirroring and captures** — `AtlasService.SaveImageBytes` writes
  pasted or drawn bytes to a Mill-owned file and returns its path (used
  by `imageTool.ts` for a pasted clipboard image, and by the Drawing
  plugin's pencil for a baked stroke SVG); `ObjectMirrorContent` reads
  a mirrored file's bytes back for rendering; `RepickObjectMirror`
  re-points an existing object at a different local file.
- **The mirror-changed subscription** —
  `useAtlasMirrorChanged(id, onChange)`
  (`frontend/src/atlas/useAtlasMirrorChanged.ts`) fires whenever a
  given object's own mirrored file changes on disk, so a renderer can
  refetch instead of polling.
- **The style value store** — `useAtlasNounStyle(nounId)` /
  `useAtlasSetStyleValue()` (`frontend/src/atlas/atlasStyleValueStore.ts`)
  is the one generic, noun-agnostic store every `styleFields`-declaring
  tool reads and writes its session-only style defaults through — never
  a bespoke per-tool store.
- **Configure entities** — when a tool's own artifact needs a
  reusable "which external thing" reference rather than a one-off
  value (`.claude/rules/architecture.md`'s business-vs-integration
  test), it goes through `ConfigureService` the way `tableTool.ts`
  mints its backing List via `ConfigureService.CreateList` /
  `AddListRow`.
- **Selection and resize — inherited, not written.** Declaring
  `resizable: true` plus a `boardNodeType` is the entire cost: the
  shared renderer that `boardNodeType` names already carries a
  `NodeResizer` and selection highlighting for every tool routed
  through it. A tool's own `commit` function never calls
  `SetBoardObjectSize` or any resize RPC itself — that call lives
  entirely in the shared renderer, fired once, for every tool that
  opted in by declaring the field.

**What you may not reach, and what actually stops you.** Compiled-in
TypeScript has no process boundary and no sandbox — nothing here is
enforced the way a browser extension's content-script isolation is.
Each line below names the real mechanism, honestly, rather than
implying a barrier that doesn't exist:

- **The workflow/composition domain** (`frontend/src/composition/`,
  and its Go counterpart `internal/domain/composition`) — enforced by
  `frontend/.dependency-cruiser.cjs`'s `atlas-must-not-depend-on-composition`
  rule, run by both Lefthook and CI's `boundaries` job. A real import
  across that line fails the build.
- **The `configure/`, `views/`, and `app/` bounded-context folders**
  your tool file has no reason to import from directly — same
  dependency-cruiser config, the `domain-folders-must-not-depend-on-views-or-app`
  and related rules.
- **The Go kernel itself** — durable execution, the guardrail engine,
  the composition graph engine. There is no TypeScript enforcement here
  because none is needed: a tool's runtime code can only call whatever
  a generated `*service.ts` bindings file happens to export, and Wails
  only generates a binding for a service's own exported Go method.
  The kernel is unreachable by construction — no RPC exists to call —
  not because a rule blocks it.
- **Other tools' own private implementation modules** — files inside
  `frontend/src/atlas/` that are not one of the APIs named above (for
  example `atlasBuildBoardObjectNodes.ts`'s internal z-order table, or
  the per-Kind branches inside the shared `AtlasBoardObjectNode.tsx`
  renderer). **This is enforced by review only.** TypeScript has no
  module-private keyword, and nothing stops a `tools/<id>Tool.ts` file
  from importing any other file under `frontend/src/atlas/` at all —
  the conformance suite above only checks two specific shared files for
  one specific bad pattern (a hardcoded tool-id branch), not every
  possible reach into implementation detail. Staying inside the surface
  documented above, once you're inside the same folder, is a norm this
  repo's reviewers hold, not something the compiler holds for you.
- **A duplicate `id`** — enforced by `registerNoun()`'s own runtime
  throw and `assertRegistryAgreesWithIdentity()`'s startup check (see
  "How it loads").

## Stability

**Stable today:** the declaration fields on `AtlasToolShape` (the
table above) and the conformance suite that checks them. Both have
already absorbed nine tools' worth of real additions without
structural change, and any drift is caught immediately — the suite
breaks the moment a field's meaning or a renderer's contract changes
underneath an existing tool.

**Not promised for compiled-in tools:** no semver, no deprecation
window, and no compatibility guarantee on the *runtime* API —
`commit`'s own signature shape, the exact set of `AtlasService` RPCs a
tool may call, or any shared renderer's internal behavior. Every
compiled-in adopter is one of Mill's own files, changed in the same
pull request as any platform change that affects it, so nothing here
needs to stay backward compatible.

**Promised for runtime plugins:** the plugin surface — the manifest
schema, the `activate(api)` shape and its argument's methods, the
`renderFace` contract, and the payload keys each `source` implies — is
versioned against **Mill's own version**, the way desktop app-plugin
ecosystems converge on versioning against the app rather than a
separate API number. A plugin pins the Mill it needs with
`minMillVersion` in its manifest; a Mill older than that refuses to
load it, saying so on its Extensions row, instead of half-running it
against a surface it predates. Within versions that satisfy the
minimum, an existing manifest field or `api` method keeps its meaning
— growth is additive.
