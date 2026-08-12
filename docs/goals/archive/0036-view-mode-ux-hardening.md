---
# 0036 — View-mode UX hardening: reachable from table view, legible as read-only

## Goal
Owner-prioritized 2026-08-12 after a live UX investigation of goal
0022's delivered view mode ("do not go with cheap option or quick
option"). The mechanics are solid — investigation confirmed run,
step-debug, pause-and-edit-before-resume, and breakpoint toggling all
work fully in read-only view mode; the edit-switch preserves canvas
state including a completed run's overlay; Runs/Versions tabs are
mode-independent. Two real gaps, both legibility/reachability:

1. **Table view (the persisted default) has NO entry into view mode**
   — WorkflowsTable wires only onRun/onEdit/onExport/onDelete; the
   only way in is the pencil straight to EDIT mode. Confirmed live
   twice (row and label clicks: zero navigation). A table-view user
   never discovers view mode exists. Owner found this themselves.
2. **View mode's node-config fields look fully editable** — normal
   text, white background, no muting (unlike CanvasMetaHeader's
   Label/Description which gray properly via their disabled prop);
   the fieldset-disabled wrapper blocks input functionally but
   invisibly. Violates the standing recognition-not-confirmation
   design principle (every surface identifiable from ambient cues
   before reading/trying).

## Plan
1. [x] Table view gains click-to-view: the Label column's cell becomes
   the open-in-view-mode affordance (DataTable has no native
   onRowClick — WorkflowRunsPanel.tsx:289's precedent), matching
   InventoryList's existing onOpen → openEditor(id,'view') wiring.
   Visually a real affordance (link-styled per Primer's DataTable
   cell-link idiom), not an invisible click target. Delivered:
   `WorkflowsTable.tsx`'s Label column keeps `field`/`rowHeader`/
   `sortBy` and adds `renderCell` rendering a Primer `Link as="button"`
   that calls a new `onOpenView` prop, wired from `CompositionView.tsx`
   as `openEditor(id, 'view')`. Pencil untouched (still straight to Edit).
2. [x] View mode announces itself: a small mode chip ("Viewing" /
   eye icon, Primer Label) in CanvasMetaHeader next to the existing
   Edit button — the ambient cue that this is read-only, present
   before any interaction. Delivered: `CanvasMetaHeader.tsx` renders a
   `data-testid="view-mode-chip"` `Label variant="secondary"` with
   `EyeIcon` + "Viewing" text next to the Edit button when `readOnly`.
3. [x] Inspector fields LOOK disabled in view mode: the fieldset
   disabled wrapper's inner Primer inputs must render visibly muted
   (investigate why Primer's TextInput/Select inside a disabled
   fieldset don't pick up disabled styling — likely they style off
   their own disabled prop, not the fieldset ancestor; pass readOnly/
   disabled into the fields themselves or apply the muted treatment
   at the wrapper, whichever is Primer-idiomatic; frontend.md's
   token-based approach for disabled styling applies). Delivered:
   investigated the installed `@primer/react` build directly
   (`TextInputWrapper-*.css`/`.js`, `Select.js`) — both key their
   `data-disabled`-driven muted background/border off their OWN
   `disabled` React prop, never off the native `:disabled` CSS
   pseudo-class the fieldset cascade puts on the real underlying
   `<input>`/`<select>`. A `<fieldset>` itself IS a real form-
   associated element that genuinely matches `:disabled` (unlike the
   plain `<span>` wrappers Primer's inputs render), so the fix is one
   CSS rule at that ancestor (`.inspectorFieldset:disabled { opacity:
   0.6; cursor: not-allowed; }`, `CompositionCanvas.module.css`,
   same treatment as the existing `.paletteItemDisabled` precedent) —
   covers every current and future nested editor uniformly, no prop
   threading through IntegrationBindingsEditor/MCPToolArgsEditor/etc.
4. [x] E2e per testing.md: table-view label click opens VIEW mode
   (not edit); the mode chip is present in view / absent in edit;
   an inspector field in view mode carries the visible disabled
   treatment (computed-style assertion, the hover-background
   precedent). Existing view-mode specs stay green. Delivered: 3 new
   tests in `frontend/e2e/workflow-view-mode.spec.ts`; full run
   (workflow-view-mode + view-mode-toggle + resizable-table specs,
   16 tests) green, no regressions.

## Acceptance
A table-view user can reach read-only view mode by clicking the
workflow's name; view mode is identifiable at a glance before touching
anything (chip + visibly muted fields); nothing about the working
mechanics (run/step/breakpoints/edit-switch) regresses.
