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
3. Node maturity plan — audited 2026-08-10 (all 18 types), worked
   top-down from here:

   | Node type | Maturity | Named gap |
   |---|---|---|
   | ruleset | ~~v1~~ **mature** (delivered 2026-08-10) | now uses the SAME react-querybuilder + ruleTranslate visual builder as Decision edges, with the raw-expr fallback — the two-condition-surfaces inconsistency is closed |
   | mcp-tool-call | v1 | argumentsJSON is a raw JSON textarea — needs a bindings-style editor like integration-http's (fetch the tool's InputSchema via ListMCPServerTools, render typed fields) |
   | human-review | ~~v1~~ **mature** (delivered 2026-08-10) | "Ask for these attributes" config names a subset (comma-separated keys; empty = all); Review renders only those |
   | trigger-schedule | ~~v1~~ **mature** (delivered 2026-08-10) | Inspector shows a live cronstrue human-readable preview (MIT, zero deps); invalid expressions flagged inline |
   | list-lookup | ~~v1~~ **mature** (delivered 2026-08-10) | explicit "If no match" option: fail / continue / default (with a default value); legacy nodes default to fail, unchanged |
   | capture-clipboard-html | ~~v1~~ **mature** (delivered 2026-08-10) | falls back to plain text when no HTML flavor (SPEC §5 order); DOM-read tier still needs the browser bridge |
   | trigger-filesystem-watch | ~~v1~~ **mature** (delivered 2026-08-10) | optional filename glob (*.md); the changed path is now delivered as the trigger payload |
   | integration-http, child-workflow, decision-route | mature | — |
   | triggers manual/hotkey/callable/clipboard-watch, capture-attribute, process-html-to-markdown, process-inject-text, apply-write-html/text | adequate | zero-config or single-field; nothing missing for their scope |
4. Spacing audit of the editor chrome (toolbar, Inspector paddings,
   palette panel) against Primer spacing tokens.

## Acceptance
Owner reviews the running app and says the authoring surface matches
the prototype's feel — explicitly a live judgment, not a checklist
(their stated review mode: "the only time I can see if it matches is
when I see it in action").
