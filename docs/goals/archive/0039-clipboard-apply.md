# Goal 0039 — Clipboard apply: "Apply from clipboard…" in the Quick Panel

Owner-driven, 2026-08-12 — the bank-critical door. At the owner's bank
MCP is deny-all (`docs/goals BACKLOG` bank-reality memory), so a
clipboard + hotkey transport is the near-term path for getting a
workflow definition INTO Mill without an MCP client. n8n's own
share/import precedent (one canonical JSON document, one import API,
every entry point — UI paste, file, URL — just another door onto it)
is the model this goal follows for Mill's own export/import shape,
already established by `compositionservice_export.go` /
`configureservice_export.go` and consumed today by the UI's own
Export/Import actions and MCP's `import_workflow`/`update_workflow`
tools.

## Goal

Add "Apply from clipboard…" to the Quick Panel (ADR-0033's floating
window): copy a Mill export JSON payload (workflow today), hit the
summon hotkey, invoke the row (or a bound command), see a preview of
what will happen, confirm, done — realtime, no reload, no MCP toggle
involved.

## Design

### 1. Surface

- A "Apply from clipboard…" row, always present in the Quick Panel's
  existing `Mill` action group (`frontend/src/app/QuickPanel.tsx`),
  alongside Open Mill / Open Settings / Review.
- A registered command `panel.applyClipboard`
  (`frontend/src/shared/commands.ts`), default binding `null` (never
  auto-bound — matches `palette.open`'s own precedent of reserving an
  ID ahead of a binding), bindable through Settings like every other
  command. Its `run()` calls `SettingsService.TogglePanel()` — the
  command exists so the action is discoverable/rebindable and so
  `HotkeyHint` can render its bound key on the panel row; the actual
  read-clipboard-and-preview flow only makes sense inside the panel
  (it needs UI to show the preview), so a bound global hotkey opens
  the panel rather than duplicating the flow in the main window. This
  is a deliberate, scoped decision, not an oversight — recorded here
  per CLAUDE.md's "state tradeoffs before editing files."

### 2. Payload = the existing export JSON, zero new formats

Structure-sniffed the same way MCP's own tools discriminate shapes:
presence of both `nodes` and `edges` arrays → a workflow payload
(`compositionservice_export.go`'s `exportedWorkflow`). Checked what
other entity export shapes exist (`configureservice_export.go`:
HTTPRequest, List, MCPServer, Decision) — none of the four are in
scope this goal (their own sniff signatures — `baseURL`/`method` for
HTTPRequest, `columns`/`rows` for List, `command` for MCPServer,
`category`/`outputs` for Decision — are a straightforward follow-up
once a use case asks for them; named here, not silently dropped).
Workflow is the only payload this goal implements.

### 3. Create-vs-update by explicit `id` presence

`exportedWorkflow` gains one new optional field:

```go
ID string `json:"id,omitempty"`
```

`ExportWorkflow` never sets it (export UI unchanged this goal —
still omits `id`, per ADR-0013's "importing mints a new identity"
precedent for the export/import round trip itself). The
**accepted-import shape** now recognizes it:

- absent → create (today's `ImportWorkflow` semantics, unchanged).
- present + matches an existing workflow ID → **update**, through the
  exact chokepoint MCP's `update_workflow` tool already uses:
  `SnapshotDraft(id)` then `UpdateWorkflowFromExport(id, json)` — the
  current draft is always snapshotted first (goal 0017's
  `mutateWorkflow` draft-snapshot semantics apply identically here,
  the change is always revertible from Versions).
- present + no match → treated as **create** (falls through to
  `ImportWorkflow`), with a note surfaced in the preview so the user
  isn't confused about which path ran.

A future share-story goal decides whether `ExportWorkflow` itself
starts carrying `id` (e.g. for a "push my edits back" round trip
between two Mill instances) — deliberately out of scope here; this
goal only extends what's *accepted*.

### 4. Preview-confirm, not park-and-poll

Clipboard apply is user-attended by definition — pressing the summon
hotkey and clicking the row IS the human being present, unlike an MCP
write from a possibly-away remote agent (ADR-0032's whole reason for
existing). So this path:

- Does **not** go through `gateWrite`/park-and-poll at all — no
  courtesy window, no Review-queue row, no MCP-writes-toggle
  dependency. ADR-0032 parks because the write's *originator* might
  not be there to answer; here the invocation itself is the answer.
- Shows one inline preview in the panel — "This will CREATE
  'X' (N nodes)" / "This will UPDATE 'Y' — replacing the current
  draft (published version untouched until you publish)" — then one
  Confirm. No double-gating.
- Malformed JSON / an unrecognized shape → a readable error inline in
  the panel, never silent (time-honesty, `.claude/rules/testing.md`'s
  UI-feature-check standard).

Two new `CompositionService` RPCs implement this
(`compositionservice_clipboardapply.go`):

- `PreviewClipboardApply(json string) (ClipboardApplyPreview, error)`
  — pure, mutates nothing. Never returns a Go `error` for a
  malformed/unrecognized payload (that's `Recognized=false` +
  `Error` on the returned value, so the panel can render it) — a Go
  `error` return is reserved for a genuine internal failure.
- `ConfirmClipboardApply(json string) (composition.Workflow, error)`
  — re-parses and re-derives create-vs-update independently (never
  trusts the client's cached preview verdict, since the clipboard or
  the workflow list could have changed in between).

### 5. Dangling-reference surfacing (sharing-research verdict)

Before confirm, `PreviewClipboardApply` walks every parsed `Node`:

- **Unknown `NodeTypeID`** — not in `composition.NodeTypes()`'s
  registry at all (e.g. an export from a Mill build with a node type
  this instance doesn't have).
- **Unresolved `RefKind`-bearing config value** — for every
  `ConfigField` on the node's type that declares a `RefKind`
  (`request`/`list`/`mcpserver`/`decision`/`execenv`/`workflow`/
  `workflow-scope`, ADR-0009), a *non-empty* value that doesn't
  resolve to a real local entity. Reuses the exact lookup seams
  execution already goes through (`composition.RefExists`, wired via
  `configuresvc.NewConfigureService`'s existing `Set*Lookup` calls) —
  never a second existence-check mechanism. An *empty* RefKind value
  is NOT flagged here — that's `validateRequiredRefs`'s own existing
  "not configured yet" warning (`ValidateGraph`, ADR-0028), a
  different, pre-existing concern.

Each unresolved entry lists node ID + config field + `RefKind` + the
value, rendered in the preview as "references an Integration that
doesn't exist here — point it at one before running." **Non-blocking**
(ADR-0028's warning-severity precedent): confirm still proceeds if the
user chooses to — import-then-fix is the converged model across
n8n/Zapier/Node-RED (checked, not assumed). No placeholder
auto-creation — explicitly deferred to a future share-story goal.

### 6. Clipboard read

Checked what exists: `internal/adapters/clipboard` (osascript/pbcopy/
pbpaste) is wired for workflow-EXECUTION-side capture/apply nodes
(`capture-clipboard-html`, `apply-clipboard-write-*`), not exposed as
a general "read clipboard text" RPC, and reaching for it here would
mean adding a new bound method whose only caller is this one panel
row. The Quick Panel is an ordinary Wails webview — `navigator.
clipboard.readText()` is available there like any browser context, and
the row's own click/Enter IS the user gesture the Clipboard API
requires. Chosen: `navigator.clipboard.readText()` in
`QuickPanel.tsx`/`QuickPanelClipboardApply.tsx`, no new Go clipboard
RPC. A permission-denied/empty-clipboard read renders the same
inline-error path as a malformed payload.

## Files

- `internal/domain/composition/refexists.go` (new) — `RefExists(kind,
  id string) bool`.
- `internal/services/compositionsvc/compositionservice_export.go` —
  `exportedWorkflow` gains `ID`.
- `internal/services/compositionsvc/compositionservice_clipboardapply.go`
  (new) — preview/confirm RPCs + dangling-ref walk.
- `frontend/src/shared/commands.ts` — `panel.applyClipboard`.
- `frontend/src/app/QuickPanel.tsx` — the row + state swap to the
  preview view.
- `frontend/src/app/QuickPanelClipboardApply.tsx` (new) — preview
  rendering + confirm/cancel.

## Proofs (`.claude/rules/testing.md` layering)

- Go unit: update-path (id-present+match → updates through
  `SnapshotDraft`+`UpdateWorkflowFromExport`, draft snapshotted;
  id-absent → creates; id-present+no-match → creates with a preview
  note) + dangling-ref detection (unknown node type, unresolved
  request/list/mcpserver/workflow refs, resolved refs never flagged,
  empty refs never flagged).
- Go unit: `RefExists` across every wired kind + the default/unknown
  case.
- E2e (`frontend/e2e/quick-panel-clipboard-apply.spec.ts`): copy a
  valid workflow export into the clipboard
  (`e2e/fixtures/clipboardLock.ts`'s `withClipboardLock`, since this
  is a real-pasteboard test), invoke Apply from the panel, preview
  shows the create summary, confirm, the workflow appears live (no
  reload) — an update case (copy an export with `id` set to an
  existing workflow, confirm, draft replaced) — a malformed-JSON case
  (readable inline error) — a dangling-ref case (preview lists the
  unresolved reference, confirm still succeeds).

## Docs

- `docs/SPEC.md` — "one API, many doors" line near §3.1/§3.6 (MCP +
  clipboard + file import/export all the same platform surface, n8n's
  own share/import precedent cited).
- This file archives to `docs/goals/archive/` in the completing
  commit; `docs/goals/BACKLOG.md` updated in the same change.

## Acceptance

- [x] `panel.applyClipboard` command registered, default binding
      `null`, shows via `HotkeyHint` when bound.
- [x] Quick Panel's Mill group always shows "Apply from clipboard…".
- [x] `exportedWorkflow` accepts optional `id`; export output
      unchanged (still omits `id`).
- [x] id-absent clipboard payload → create; id-match → update through
      `SnapshotDraft`+`UpdateWorkflowFromExport`; id-no-match → create
      with a preview note.
- [x] Preview never silently fails on malformed/unrecognized JSON —
      readable inline error.
- [x] Dangling RefKind references (and unknown NodeTypeIDs) listed in
      the preview, non-blocking.
- [x] MCP write-approval settings do NOT gate this path.
- [x] Go unit tests + e2e cases above, all green.
- [x] SPEC.md's "one API, many doors" line added.
- [x] BACKLOG.md updated; this file archived on completion.
- [x] Full local suite green; PR opened, auto-merge armed, checks
      watched through merge.

## Delivered 2026-08-12

All acceptance boxes above checked against what shipped, not what was
planned. One scoped decision made during implementation, not in the
original brief: `SettingsService.ShowPanel` (new, bound RPC) was added
alongside `panel.applyClipboard` so a bound hotkey pressed while the
MAIN window has focus can still bring the Quick Panel forward —
`TogglePanel` stays `//wails:ignore` (Go-internal, summon-hotkey-only)
per its own existing doc comment, so a new minimal show-only RPC was
the smallest correct addition rather than either lifting that
constraint or leaving the command non-functional from the main window.
