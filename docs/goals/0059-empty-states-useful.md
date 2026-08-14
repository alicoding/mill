# 0059 — Empty states that stay useful

**Raised:** 2026-08-14, owner, from live screenshots: Activity's
empty state is one grey sentence in a full-page void ("it feels like
it needs a better way to make it feel like it can still be useful");
Review's is the counter-example that half-works already (states the
surface's purpose, shows Recently resolved history beneath).

## Goal

Every empty state answers, in its own surface: what this view is
for, and what the user can DO right now — with a real action, not
just prose. The kit already carries the anatomy: Primer's Blankslate
(graphic + heading + description + primary action + secondary link)
is used properly on Home's "No runs yet" and half-heartedly or not
at all elsewhere. This is applying the kit's own component to its
full extent, not inventing chrome (frontend.md's rule, one level
down).

## Plan

1. Inventory every empty state (Activity live feed, Review queue,
   a workflow's Runs tab, Workflows list post-delete, Configure
   family pages, Quick Panel no-results, Home ranges) — each gets:
   current state, the ONE most useful next action, secondary
   pointer if any.
2. Sweep to full Blankslate anatomy with navigating actions (e.g.
   Activity empty → "Run a workflow" button that jumps to
   Workflows; Review empty keeps Recently resolved and gains
   nothing-pending copy that references where approvals come from).
   Copy per ux-writing.md — front-loaded, no spec-asides; the
   Activity header's "the only place a headless trigger shows up,
   cleared when Mill restarts" clause gets the same copy pass while
   in the file.
3. E2e: empty-state actions asserted (button navigates) per
   testing.md's interaction layer.

## Acceptance (checkable)

- [ ] Inventory table recorded here: every empty surface, its
      action, its copy — no view left as bare prose.
- [ ] Each empty state uses the kit's Blankslate anatomy with a
      working primary action; e2e asserts at least the Activity and
      Review actions navigate.
- [ ] Copy passes ux-writing.md (no internals, front-loaded); the
      Activity header spec-aside is reworded in the same change.
- [ ] SPEC.md §3 status note (empty-state pattern recorded as the
      standing convention for new views).
