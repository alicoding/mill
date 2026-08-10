# 0001 — Authoring-surface overhaul

## Goal
The workflow editor looks and feels designed, not accreted — judged
live by the owner against their own reference prototype (the style
elements recorded in `docs/SPEC.md` §3.8's authoring-surface
direction). Direct critique (2026-08-10, screenshots): default zoom
too close, systemic spacing issues, palette poorly grouped/represented
with inconsistent label conventions, and no per-node maturity story.

## Plan
Increment 1 (delivered 2026-08-10, this repo's commits): fit-zoom
capped at 100%; single-line inputs by default with a typed
`ConfigField.Multiline` for real documents; palette casing unified +
card-style items + small-caps kind headers; canvas cards carry the
prototype's small-caps taxonomy label.

Remaining, in order:
1. Typed payload visibility on cards (the prototype's
   `Output TypedPayload<...>` line) — needs a per-node-type declared
   output description first (small Go addition, honest not invented).
2. Live run state on the canvas (DONE/ACTIVE/PENDING per card +
   inline approve/reject) — reuse the runs/pending data that already
   exists; design pass against the prototype screenshot before code.
3. Node maturity plan: a per-node-type audit (config completeness,
   description quality, seeded-example coverage, Inspector UX) →
   recorded as a table in this file, then worked top-down.
4. Spacing audit of the editor chrome (toolbar, Inspector paddings,
   palette panel) against Primer spacing tokens.

## Acceptance
Owner reviews the running app and says the authoring surface matches
the prototype's feel — explicitly a live judgment, not a checklist
(their stated review mode: "the only time I can see if it matches is
when I see it in action").
