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

## Inventory

| Surface | Before | Action chosen | Copy |
|---|---|---|---|
| Activity live feed (no runs this session) | Bare centered prose, no icon | Full Blankslate; primary action "Run a workflow" navigates to Workflows (`setView({kind:'composition'})`) | Heading "No activity yet"; description "Run a workflow to see it appear here, or pick one above to browse its history." |
| Activity → a selected workflow's own run history (ActivityRunsExplorer) | Blankslate with heading only, no description/action | Primary action "Open workflow" opens that workflow's editor tab (`requestOpenWorkflow`), landing on Canvas | Heading "No runs recorded yet"; description "Run this workflow to see its history here." |
| A workflow's own Runs tab (WorkflowRunsPanel) | Blankslate with heading only; prose told the user to "run this workflow from its Canvas tab" instead of doing it | Primary action "Go to Canvas" switches the SAME editor tab's inner selection to Canvas (`WorkflowEditorTab`'s `onSwitchToCanvas`) | Heading "No runs yet"; description "Run this workflow from Canvas to see its history here." |
| Review queue (nothing pending) | Blankslate with heading only, no description | **No action added** — reasoned no-op: an approval only appears once some workflow with guardrail/review rules actually runs, and there's no single honest destination (not "Workflows" generically, not any one workflow) to send the user to. Recently-resolved list below is unchanged. | Heading "Nothing waiting for you" (unchanged); added description "Approvals land here when a workflow needs your review — a guardrail ask, a review checkpoint, or an MCP write request." |
| Workflows list (post-delete-all) | Already full Blankslate anatomy with a "New workflow" primary action (`CompositionView.tsx`'s `InventoryList` `emptyState.action`) | **No change** — already correct; confirmed reachable (every workflow, including seeded ones, is deletable) | Unchanged |
| Configure → Attributes | Blankslate with description telling the user to go create a workflow manually ("Workflows > New workflow") instead of doing it — the exact anti-pattern this goal fixes | Primary action "Go to Workflows" navigates to the Workflows section — Attributes has no create-flow of its own, since attributes are declared per workflow, not a standalone entity | Heading "No workflows yet" (unchanged); description reworded to "Attributes are declared per workflow — create one to get started." (dropped the internal `Workflows > New workflow` breadcrumb reference) |
| Configure → Lists / Exec envs / Decisions / MCP servers / AI providers / Integrations | Already full Blankslate anatomy with a "New \<entity\>" primary action | **No change** — already correct across all 6 remaining Configure family pages | Unchanged |
| Quick Panel / Command Palette no-results | `FilteredActionList`'s own built-in `messageText` (title + description), not a Blankslate | **No action added** — reasoned no-op: it's a popover, not a page; a full Blankslate would be heavier chrome than the surface warrants, and the existing "No matches" / "Nothing to search yet" messaging already tells the user what happened | Unchanged ("No matches" / "Nothing matches "{{query}}"" / "Nothing to search yet.") |
| Home (no runs in the selected date range) | Full Blankslate anatomy (graphic + heading + description) but no primary action | Primary action "Run a workflow" navigates to Workflows, same target as Activity's | Heading/description unchanged; action label added |

## Acceptance (checkable)

- [x] Inventory table recorded here: every empty surface, its
      action, its copy — no view left as bare prose.
- [x] Each empty state uses the kit's Blankslate anatomy with a
      working primary action; e2e asserts at least the Activity and
      Review actions navigate. Deviation from the literal wording:
      Review's own empty state has no navigating action (see the
      inventory row above for why none is honest) — e2e instead
      asserts Review's full Blankslate anatomy (heading + description)
      renders, and Activity's + the Runs tab's + ActivityRunsExplorer's
      actions all navigate/switch section as asserted.
- [x] Copy passes ux-writing.md (no internals, front-loaded); the
      Activity header spec-aside is reworded in the same change.
- [x] SPEC.md §3 status note (empty-state pattern recorded as the
      standing convention for new views).
