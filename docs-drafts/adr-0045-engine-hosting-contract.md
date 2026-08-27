# ADR-0045: Engine hosting contract — Mill ships the seam, never the engine

- Status: DRAFT (goal 0237 S1) — orchestrator review + placement pending.
  Not yet a numbered ADR in `docs/adr/`; the owner assigns the real
  number and merges this into the nested docs repo.
- Date: 2026-08-27
- Related: `docs/goals/0237-embedded-editor-engines.md` (S0 verdict, S1
  scope), ADR-0035 (core/composition boundary), ADR-0043 (drawio viewer
  vendoring), ADR-0009 (Configure entity RefKind — the S2 source-override
  entity this ADR's seam anticipates but does not build).

## Context

Goal 0237 embeds a third-party tool's REAL editor inside Mill, starting
with draw.io (S1). The recorded pattern (VSCode's drawio extension,
draw.io's own embed mode, Obsidian's Excalidraw plugin) is: the host
app builds a HOSTING SEAM once; the tool vendor supplies the engine.
This ADR locks that seam's shape so every future engine (mermaid S2,
plantuml/Kroki S3+) rides the same contract instead of each getting its
own bespoke integration.

The owner's explicit constraint, stated at goal filing: **"Design from
day one to not pay the tax of catching up with drawio updates — not
just this one, as a pattern."** This ADR is that design.

## Decision

### The seam: same-origin iframe + documented JSON postMessage protocol

An embedded-editor-shaped engine (draw.io today; any future full-UI
editor) mounts as a same-origin `<iframe>` loading the vendored engine's
own entry page with `embed=1&proto=json&spin=1`. Mill's host code speaks
ONLY the engine's own documented protocol:

- Editor → host: `{event: 'init'}` on ready.
- Host → editor: `{action: 'load', xml, autosave: 1}` — the mirror
  file's current XML, autosave armed so every subsequent edit arrives
  as its own event rather than requiring a manual Save.
- Editor → host: `{event: 'autosave', xml}` / `{event: 'save', xml,
  exit?}` on every change / manual save. Host writes `xml` to the SAME
  mirror file the board's existing fsnotify watch (goal 0194) already
  observes — Mill never emits its own change signal; the watch fires on
  its own debounce, so the board preview updates through ONE path,
  never two racing ones.
- Editor → host: `{event: 'exit', modified}` when the user closes the
  editor's own UI. Host closes the mount. No defensive re-write is
  needed: `autosave: 1` above means every prior edit already landed on
  disk before `exit` can fire — unsaved-changes protection is the
  protocol's own autosave semantics, not a Mill-built guard.

This exact protocol is implemented as a PURE function
(`frontend/src/atlas/drawioEmbedProtocol.ts`,
`nextDrawioActions(message, currentXML) → actions[]`) — no DOM, no
iframe, no fetch. `DrawioEditorMount.tsx` is the one real caller,
translating actions into a real `postMessage`/RPC/close. This split is
what makes the engine swappable and the contract test possible (see
below).

### Why iframe+protocol over the recorded opener-bridge fallback

S0's spike leaned toward hediet's VSCode-extension approach (load the
vendored webapp TOP-LEVEL via an undocumented `window.opener` bridge) as
marginally simpler. S1 overrides that lean: Mill's locked-down-
environment requirement (a self-hosted tomcat/Confluence-licensed drawio
instance, reachable only as a URL) can ONLY mount as an iframe — a
same-origin URL a host page embeds, never something Mill's own process
loads top-level. Since that iframe path has to exist anyway for the
self-hosted-URL source kind (goal 0237, S2's Configure entity), running
the BUNDLED engine through the exact same seam means one mount
implementation, one protocol, zero reverse-engineered API — never two
integration paths to maintain. S1's own WKWebView gate-zero check
(Chromium via server-mode Playwright: real init/load round trip,
zero non-localhost network requests) cleared this path before any
further build; the real-webview equivalent is a stated manual-only
verification (`.claude/rules/testing.md`'s registry) pending a
dedicated `webviewbridgesmoke` check once the UI trigger exists to
drive it.

### The mount owns Kind-and-extension gating; the engine owns nothing about Mill

The registry gate lives entirely in `AtlasBoardObjectContent.editable`
(`frontend/src/atlas/atlasNounRegistry.ts`) plus a per-extension check
(`isDrawioEditableExtension`, `atlasDiagramMirror.ts`) — a noun declares
"I have an embedded-editor engine," Mill decides which mirror extension
that engine actually opens. The engine itself never learns anything
about Mill's board-object model, Kind vocabulary, or Configure entities
— it only ever receives XML bytes and sends XML bytes back, over the
documented protocol. This is what keeps the engine swappable: a
self-hosted URL or a newer bundled build satisfies the exact same
contract with zero Mill-side changes beyond the mount's `src`.

### Save round-trip reuses the existing mirror-write + fsnotify-watch path

`AtlasService.WriteObjectMirror(objectID, xml)`
(`internal/services/atlassvc/atlasservice_mirrorwrite.go`) is the ONE
new Go RPC this slice adds: resolve the object's `Payload.mirrorPath`,
validate it's still a diagram-mirror extension, `os.WriteFile`. It
deliberately does NOT call `emitMirrorChanged` itself — the write lands
on the same path `armMirrorWatch` (goal 0194) is already watching, so
the existing debounced fsnotify callback fires the refresh on its own.
Building a second "I just saved, refresh now" signal here would race
the watch's own and is exactly the kind of parallel machinery
composition-never-reaches-through (see below) forbids for a capability
the platform already owns.

## The four no-catch-up-tax rules, as built

1. **The engine is data, not code.** `frontend/public/vendor/drawio/
   editor/` is a directory of static assets (a full webapp tree: HTML,
   minified JS bundles, stencil/shape/template data) served as-is by
   Vite's public-asset pipeline — never imported as a JS module, never
   compiled into Mill's Go binary or its Rollup bundle. Swapping it for
   a newer commit, a local fork, or (S2) a self-hosted URL never touches
   Mill's own source.
2. **Engines update off Mill's release train.** The vendored directory
   carries its own pinned-commit provenance
   (`frontend/public/vendor/drawio/PROVENANCE.md`) independent of Mill's
   version. A refresh is a directory replace + a PROVENANCE update, not
   a Mill feature release — deliberately the OPPOSITE of hediet's own
   VSCode extension, which re-vendors drawio on every extension release
   (the exact tax this rule exists to avoid, per the goal file).
3. **Mill codes against the protocol, not engine internals.**
   `drawioEmbedProtocol.ts`'s pure handler is asserted against a
   FAKE-ENGINE contract test (`drawioEmbedProtocol.test.ts`) — plain JS
   objects shaped exactly like the documented protocol, fed straight
   into the handler, no real vendored asset involved. This test must
   keep passing across any future engine swap that still speaks this
   documented shape; a real protocol break shows up as a contract-test
   failure, not a silent runtime regression discovered later.
4. **The bundled copy is a convenience snapshot, allowed to age.** No
   CI job re-fetches or re-validates the vendored commit; nothing gates
   a release on it being current. It exists so day-one usage works
   fully offline, nothing more.

## Composition-never-reaches-through (ADR-0035 §9.5 bar)

The engine-hosting seam itself — the mount component, the protocol
handler, the mirror-write RPC, the fsnotify watch it rides — is KERNEL,
not composition: no workflow node, trigger, or Configure entity ever
constructs an iframe, speaks this protocol, or calls
`WriteObjectMirror` directly. What composition DOES reach going
forward (S2): which engine a given noun's mirror opens is a Configure
`RefKind` entity (source: bundled / local path / self-hosted URL,
per architecture.md's "which external thing" test) — but that entity
only ever selects a `src` for the SAME mount; it never gets its own
protocol implementation or its own mirror-write path. A second engine
(mermaid) registers through the SAME `AtlasBoardObjectContent.editable`
seam (S2) rather than a parallel mini-pipeline — this is the
"registry-shaped, never a second implementation" rule the goal file
states explicitly for engine two.

## Consequences

- A locked-down-environment deployment (self-hosted tomcat/Confluence
  drawio, S2) satisfies the SAME contract this ADR locks — no separate
  code path, only a different `src` and (S2) a Configure-sourced URL
  instead of the vendored path.
- The contract test (`drawioEmbedProtocol.test.ts`) is the regression
  gate that survives an engine upgrade; it must be extended, never
  replaced, when a new documented event/action is adopted.
- `WriteObjectMirror` is scoped to board OBJECTS only (S1). A promoted
  diagram CARD's own `MirrorPath` field would need the equivalent
  `WriteCardMirror` if/when card-level embedded editing is scoped —
  deliberately not built speculatively this slice.
- Mermaid (S2) breaks this ADR's "embedded-editor" assumption in one
  place: no embeddable mermaid editor exists (S0's honest finding), so
  engine two is composed from a text pane + Mill's own already-shipped
  `useMermaidRendering`, NOT a second iframe+protocol mount. The
  `editable` registry flag therefore names "has an edit door," not
  "mounts an iframe" — S2 must keep that distinction honest rather than
  forcing mermaid through a protocol it has no editor to speak.
