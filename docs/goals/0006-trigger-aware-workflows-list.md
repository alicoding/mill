# 0006 — Trigger-aware Workflows list (the input node defines the row's affordance)

## Goal
Owner's model, raised live 2026-08-10 (drafted the night before): the
generic per-row "Run" button is not 100% correct — **the input/trigger
node is what's configured to "run" things**, so each Workflows-list row
should carry a tiny label showing the trigger's type AND its action
state, with the primary affordance derived from it. The current
incoherence proving the point: "Example: Echo message (callable
child)" says "only runnable by another workflow" and still shows Run.

Sketch (to be finalized against the research pass):

| Trigger | Tiny label | Primary action |
|---|---|---|
| Manual | ▶ Manual | Run — the click IS the trigger |
| Hotkey | ⌨ the assigned combo, or amber "not assigned" | label is the state; Run secondary |
| Schedule | 🕐 humanized cron (cronstrue) + armed/paused | enable/disable |
| Clipboard/FS watch | 👁 what it's watching + armed/paused | enable/disable |
| Callable | ↩ run by another workflow | no Run; Test only |

## Plan
1. [x] Research (2026-08-10, primary-sourced): n8n's Active toggle
   gates listener registration only, manual runs are ad-hoc and never
   count as production (a manual-trigger workflow being "inactive" is
   by design, not an error); Airflow tags `run_type: manual` in one
   engine; Raycast renders hotkeys inline in the list, assignable
   in-place ("Add Alias" placeholder, red conflict naming the owner),
   and treats hotkey-set/unset as a filterable row property. Zapier's
   list-row anatomy could not be primary-sourced (flagged, not
   guessed). Mill-side: all row data already exists client-side (root
   computation already duplicated in WorkflowsCards.tsx's orderNodes;
   SchedulePreview.tsx reusable; ListHotkeys) except ONE gap — an
   armed-state getter (TriggerService's arming is an unexported map,
   gated on `!Disabled && PublishedVersion > 0`, triggerservice.go:184).
2. [x] Owner decisions (2026-08-10, all three ratified explicitly):
   - **Manual list-Run stays a test run of the draft** (every
     researched precedent converges there; ADR-0008/0021 as built) —
     but the button labels itself honestly: "Test run · draft", and
     flags when the draft differs from the published version.
   - **Armed is a tri-state** — armed / configured-but-not-live /
     unconfigured — with a Publish CTA directly on a
     configured-but-not-live row (the publish gate is what's actually
     blocking the trigger from arming). Needs the small `ListArmed()`
     (or equivalent) Go getter.
   - **Hotkey assignment is inline from the row** (Raycast's full
     pattern: "Add hotkey…" placeholder, click-to-record in place,
     reusing the existing conflict UX).
3. [x] Implemented (2026-08-10), 104/104 e2e twice:
   `TriggerRowLabel.tsx` (shared by Table + Cards via
   `triggerRowInfo.ts`'s root derivation), `ArmedWorkflows()` reading
   TriggerService's real listener map (never a recomputed gate),
   Publish CTA on configured-but-not-live rows, inline hotkey capture
   from the row (reusing `useHotkeyCapture` + existing conflict UX),
   callable rows demote Run to a secondary "Test", and honest
   Run tooltips including draft-drift detection (`draftDrift.ts` —
   feasible client-side since `WorkflowVersion` carries full
   snapshots). Confirmed en route: hotkey listeners go through the
   SAME publish gate as schedule/watch (no special case), so the
   tri-state applies uniformly — an assigned combo on an unpublished
   workflow truthfully shows not-live. The new Trigger column
   initially broke `resizable-table.spec.ts`'s no-overflow assertion —
   the committed-test discipline catching a real regression — fixed
   with the §3.8 long-column conventions (`growCollapse`).

## Acceptance
Owner reviews the list live: every row's affordance matches its
trigger's real meaning and state; the callable-child incoherence is
gone; a hotkey row shows its combo (or that none is assigned) without
opening the editor.
