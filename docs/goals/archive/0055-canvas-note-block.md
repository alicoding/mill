# 0055 — Canvas note block (authoring-space annotation)

**Raised:** 2026-08-14, owner: documenting steps inside the authoring
space is a legitimate converged pattern ("I've seen in n8n at least
that pattern" — sticky notes on the canvas), distinct from the
workbench question (goal 0056) and buildable independently.

## Scope

A free-floating note/annotation block on the workflow canvas: plain
text (markdown rendering optional, decided in-goal against precedent),
movable/resizable, saved with the workflow, exported with it (it's
part of the workflow's definition, so it rides the same envelope —
which means the 0052 schema must include it if 0052 lands first;
coordinate whichever goal is second). NOT a step: it has no
execution, no edges, no config — verify the canvas/store/export
model can carry a non-step element cleanly before building
(capability check, not assumption).

## Research to open with

n8n sticky notes as the primary precedent (grouping/color behavior),
plus the other canvas tools' annotation shapes — what converged
(free note vs attached-to-step comment vs both), what's ignored in
practice. Pick the minimal converged shape; no color-taxonomy
speculation without evidence people use it.

## Acceptance (checkable)

- [x] A note can be added, edited, moved, and deleted on the canvas;
      persists with the workflow; round-trips export/import.
- [x] Notes are visibly not steps (no ports, excluded from
      execution/validation paths — asserted in a test).
- [x] Seeded example workflow carries at least one note documenting
      its own steps (seeds ARE the proof).
- [x] E2e covers add/edit/persist; unit covers any pure layout/
      serialization logic.
- [x] SPEC §3 canvas section updated in the same change.

## Shipped

Delivered as a single change: `composition.Note{ID, Text, Position,
Size, Color}` (`internal/domain/composition/types.go`), added to
`Workflow.Notes`/`WorkflowVersion.Notes` (`SnapshotHead` carries it
through). Structurally excluded from execution/validation by
construction, not a runtime check: `ValidateGraph`/`ExecuteWorkflow`
only ever take `[]Node`/`[]Edge`, never a `Note` or a `*Workflow` —
`note_test.go` pins this against a real graph/execution run, including
an id-colliding Note to rule out any accidental interaction.

Persistence: its own `CompositionService.UpdateNotes` RPC, the same
workflow-scoped-collection shape `UpdateAttributes` already
established (not folded into `CreateWorkflow`/`UpdateWorkflow`'s
Nodes/Edges signature, which would have touched every existing call
site and test across the package). Export/import: the envelope's
`notes` field is `json:"notes,omitempty"` — additive-optional per
ADR-0036 decision 2, schema major stays v1, an export with no notes
stays byte-identical to a pre-0055 one (pinned by
`TestExportWorkflow_NoNotes_OmitsNotesField`).

Research verdict (n8n sticky notes, the primary precedent this goal
named, plus a scan of Excalidraw/Miro/tldraw's own annotation shapes):
a single free-floating note, a small fixed color palette (n8n's own
convergence — no evidence of an open-ended picker seeing real use),
and no grouping/attached-to-step-comment variant — nothing in the
researched precedent showed grouping as a load-bearing feature versus
just several notes near each other, so it's not built. Markdown
rendering: plain text only, same reasoning (no evidence of real use
beyond bold/italic ad hoc, and Mill has no other in-app markdown
renderer to reuse — would be a new dependency for an unproven need).

Canvas: a distinct React Flow node type (`CanvasNoteView.tsx`,
`'note'` in `rfNodeTypes.ts`) — borderless, muted-color, no kind chip,
no `Handle`s. Resizing verdict: `NodeResizer` IS present in the
installed `@xyflow/react` (12.11.2) and is used directly — no
fixed-size-with-autogrow fallback was needed. Added via the canvas
toolbar's "Add note" button (`CanvasToolbar.tsx`), never the step
palette. Double-click enters inline editing, a handler kept separate
from a step card's own double-click (guarded in
`CompositionCanvas.tsx`'s `onNodeDoubleClick` by `node.type ===
'note'`) so the two never collide.

Dirty-path: verified through the existing hot-exit mechanism, not a
parallel one — `canvasScratch.ts`'s `ScratchDraft`/`buildScratchDraft`/
`normalize` all gained a `notes` field, and `useCanvasHotExit`'s dirty
check now includes it (`canvasScratch.test.ts` has direct
add/edit/reorder-is-a-no-op cases for notes specifically).

Seed: "Example: Scratch capture" (the most recently added seed at
goal-start, per the brief's own preference) gained one documenting
note and its `SeedRevision` bumped 1→2
(`builtinworkflows_capturefloor.go`), fingerprinted
(`seed_fingerprints.json`) and reconcile-upgrade tested
(`TestReconcileBuiltIns_UpgradeCarriesGoldenNote`). Adding the `Notes`
field to `composition.Workflow` mechanically changed every OTHER
golden's content hash too (a new struct field, even nil-valued,
changes its JSON encoding) — those fingerprints were refreshed with
their `SeedRevision`s left untouched (no other golden's authored
content actually changed), matching `TestSeedFingerprints_
MatchCommittedRecord`'s own failure-message instructions.

E2e: `composition-canvas-notes.spec.ts` — add via toolbar, double-click
to edit, drag, save, reload (persists), Run (a completed run shows
exactly one `node-run-status` badge, the trigger — the note gets
none), switch to edit, select + delete, confirmed absent from the step
palette throughout.

No deviations from the locked design decisions in this session's
brief.
