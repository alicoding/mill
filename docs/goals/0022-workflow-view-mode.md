# Goal 0022 — Workflow view mode: row click inspects, Edit is explicit

Owner-requested 2026-08-11: "read-only mode should allow us to click
the workflow without editing mode but still able to go in and run/test;
the editing mode just allows changes to the nodes." This extends
[ADR-0014](../adr/0014-configure-layout-inspect-vs-edit.md)'s
already-accepted inspect-vs-edit split (built for Integrations) to
workflows — one grammar across the app, no new ADR needed.

## Design

- **Row click → View mode** (`workflow-view` semantics): the canvas
  rendered read-only — no palette, no node dragging/connecting, no
  config editing; node click shows read-only config/data. Run, step
  mode, the live-run overlay, breakpoint-pause inspection, and the
  Runs/Versions inner tabs all fully work — view mode is the natural
  home of the run/debug experience.
- **Edit is the explicit gesture**: an Edit button in view mode
  switches the same work tab into today's editor; the list row's
  pencil action goes straight to edit. Hot-exit scratch, dirty dots,
  and the external-change banner apply to edit mode only (a view tab
  can always take an external update silently — nothing to clobber).
- Tab restore (§3.7's rule): view tabs restore like today's
  workflow-edit tabs; a tab in edit mode restores per existing
  hot-exit behavior.
- Reuse, don't duplicate: the read-only canvas is CompositionCanvas
  with interactions disabled (React Flow's own nodesDraggable/
  nodesConnectable/elementsSelectable props) — NOT a second canvas
  component; WorkflowHoverPreview's read-only rendering is precedent.

## Acceptance

- Clicking a workflow row opens view mode: canvas visible, palette
  and inspectors absent/read-only, Run + stepped Run work, Runs and
  Versions tabs reachable.
- Edit button (and the row pencil) opens the full editor; edits +
  save behave exactly as today, including hot-exit and validation.
- A running/stepped run's overlay renders in view mode; approving/
  stepping from the CurrentStepBar works there.
- e2e covers: row click = read-only (a drag attempt doesn't move a
  node; no palette), Edit switch, run-from-view; existing editor
  specs updated for the new entry path.
