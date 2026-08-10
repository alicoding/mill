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
1. [ ] Research (in flight, launched 2026-08-10): n8n/Zapier/Raycast
   list-row trigger affordances; the manual-Run semantics question —
   today every list Run is a TEST run of the DRAFT (ADR-0008), which
   is arguably wrong for a manual-trigger workflow whose click is its
   production gesture (triggered-kind on published?). Also confirm all
   row data already exists (hotkey bindings, cron, Disabled, callable
   detection).
2. [ ] Decide the manual-Run semantics with the owner (it changes run
   history), write the row anatomy up (small ADR or a SPEC §3.4/§3.8
   update), then implement with e2e.

## Acceptance
Owner reviews the list live: every row's affordance matches its
trigger's real meaning and state; the callable-child incoherence is
gone; a hotkey row shows its combo (or that none is assigned) without
opening the editor.
