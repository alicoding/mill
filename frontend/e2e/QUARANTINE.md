# E2e quarantine register (goal 0080)

The committed record replacing the "known flakes" folklore list that
used to circulate in agent-brief prose. Protocol (testing.md): a test
observed flaking twice enters here with class, owner, and review
date, and gets `@flaky` in its title — or gets fixed instead. Entries
leave by fix (preferred) or by their review date forcing a decision.
Retry-passing is NOT a fix.

Classes: **live-run** = polls a real workflow run's terminal status
(inherently timing-sensitive under contention); **interaction-race**
= geometry/pointer race with a known standing-helper fix;
**unclear** = no identified signature yet — first recurrence gets a
trace (now auto-captured on retry).

| Spec:line | Class | Entered | Review by | Notes |
|---|---|---|---|---|
| home.spec.ts:26 | live-run | 2026-08-16 | 2026-09-16 | run-button re-enable after real run |
| breakpoints.spec.ts:80 | live-run | 2026-08-16 | 2026-09-16 | paused-at-breakpoint polling |
| seed-completeness.spec.ts:62,84 | live-run | 2026-08-16 | 2026-09-16 | SUCCESS-status polling |
| decision-outcome.spec.ts:192 | live-run | 2026-08-16 | 2026-09-16 | SUCCESS-status polling |
| mcp-write-staleness.spec.ts:21 | live-run | 2026-08-16 | 2026-09-16 | real MCP round-trip |
| guardrail.spec.ts:238 | live-run | 2026-08-16 | 2026-09-16 | approve/deny resolve polling |
| state-persistence.spec.ts:74 | unclear | 2026-08-16 | 2026-09-16 | reload/IPC timing; await first trace |
| configure-lists.spec.ts:105 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| quick-panel.spec.ts:132 | unclear | 2026-08-16 | 2026-09-16 | cross-document nav; await first trace |
| atlas-projections.spec.ts:108 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| workflow-lifecycle.spec.ts:52 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| atlas-containment.spec.ts:136 | interaction-race | 2026-08-17 | 2026-09-22 | the Area tool's own marquee draw (a real pointer-capture drag, not React Flow's own node drag) occasionally no-ops -- CONFIRMED real and reproducible again 2026-08-22 (2/22 local `--retries=0` runs, self-heals on retry every time observed), on the SECOND marquee in the file (marker-box grouping), not only "the last" as first logged. CONFIRMED a DIFFERENT mechanism than the drag-file entry this same line used to be conflated with (see "Fixed" below): this marquee's start/end points are both on open canvas, nowhere near the board's fixed corner chrome (minimap/creation tray/zoom controls) at the moment it fires -- checked directly against a passing run's own screenshot. waitForViewportStable already applied at every zoom-changing step; root cause within the Area tool's own pointer-capture handling not yet isolated |
| workflow-runs-panel.spec.ts:116 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| layout.spec.ts:163 | unclear (contention-only) | 2026-08-16 | 2026-09-16 | fails only under parallel local load |
| atlas-folder-import.spec.ts:113 | unclear (contention-only) | 2026-08-18 | 2026-09-18 | "Add 1 cards" click times out only under 4-worker parallel local load (own dedicated server, so not a cross-spec data race); passes clean in isolation and on retry every time observed |
| composition-canvas-interactions.spec.ts:25 | interaction-race | 2026-08-17 | 2026-09-17 | clickCanvasNode's own toPass retry loop times out ("element is outside of the viewport" across every retry) selecting the upstream node before the Inspector-composed drag; reproduces in isolation and pre-existing on unmodified main (unrelated to goal 0081 slice A3), not yet traced |
| composition-canvas-interactions.spec.ts:92 | CI-only skip | 2026-08-15 | goal 0069's revisit clause | the one honest skip; four fix layers recorded. Reproduced LOCALLY too as of 2026-08-16 (2/2 attempts, on both the pre- and post-0080-burn-down code -- not a burn-down regression), contradicting the in-file comment's "every local mode... passes 10/10"; that comment needs a re-check, not yet done here |

## Fixed (pattern applied)

Entries below left the active register on this date, fixed by applying
`waitForViewportStable` (`frontend/e2e/fixtures/animation.ts`, goal
0080's burn-down) at the interaction-race site, not by a retry pass.

| Spec:line | Class | Fixed | Notes |
|---|---|---|---|
| live-run-state.spec.ts:87 | interaction-race | 2026-08-16 | connectNodes now waits for the viewport transform to settle before the hover-based drag |
| atlas-scale.spec.ts (first attempt) | interaction-race | 2026-08-16 | boundingBox-then-act sequences after the initial fitView and both drills now wait for viewport stability first |
| step-detail-overlay.spec.ts:99 | interaction-race | 2026-08-16 | the in-file settle helper promoted into fixtures/animation.ts; the double-click path already called it |
| atlas-containment.spec.ts (drag-file-in/out steps, was miscategorized under this file's own :105 entry) | occluded-drag-start, NOT a race | 2026-08-22 | goal 0170: MEASURED (not inferred) -- `document.elementFromPoint` at the drag's own start coordinate resolved to the board's minimap panel (`data-testid=rf__minimap`), not the card, and a cropped screenshot at that instant shows the card's bottom half visually painted over by the minimap's own background. Deterministic given fixed test geometry (5/5 local `--retries=0` failures before the fix, same assertion every time) -- CI's retries had been masking a 100%-reproducible defect as an intermittent. Owner-ruled EXPECTED canvas behavior (topmost element correctly wins the pointer), so the fix is test-side: a new `hittablePointOn(page, locator)` helper (`fixtures/atlasBoard.ts`) verifies a drag's start point is really hit-testable via `elementFromPoint` before committing to it, walking a small grid of fallback points on the target element instead of assuming its geometric center is reachable -- applied at all four card-drag sites in this spec. Not a `waitForViewportStable`-pattern fix (this table's own header describes that pattern; this entry is the exception) |

## atlas-select-group.spec.ts (box-drag test only — test.fixme)
- **Class**: pointer-coalescing on synthesized drags (the config
  header's documented class) — the shift-drag box select is the
  app's ONLY multi-select door (plain click glances, meta-click
  opens per the locked gesture map), and React Flow samples deltas
  between real pointermove events, so synthesized moves coalesce
  into a rectangle it never registers. Coin-flip even solo; fails
  CI shards 3/3.
- **Entered**: 2026-08-17. **Review**: 2026-08-31.
- **Status**: test.fixme (runs nowhere) — NOT retry-tolerated,
  because it fails both CI retries when it fails.
- **Coverage ledger**: the selection-overlay context-menu fix this
  spec was written for is probe-proven live (menu opens, "Group
  into new area" present, New-area popover completes) and the
  selection-preservation half is covered by the containment spec.
  The full gesture chain's check is the manual-only registry entry
  in .claude/rules/testing.md (box-select → right-click → group).
- **Investigated and ruled out**: menu-animation race, same-port
  server race, test budget (180s also consumed), file-worker
  interference, deterministic click-selection (impossible at entry
  time — the gesture map assigned click/meta-click elsewhere).
- **Update (goal 0092)**: shift-CLICK toggle joined the gesture map
  (multiSelectionKeyCode), which IS deterministically synthesizable
  — the same spec file's shift-click test now CI-proves the full
  select → member-right-click → Group chain and Delete-over-
  selection. Only the box-drag SYNTHESIS remains quarantined; its
  live check stays in testing.md's manual registry.

## atlas-table-resize (entered 2026-08-20, review 2026-09-20)
Class: pointer-coalescing (same family as atlas-select-group's
box-drag). The NodeResizer drag in
atlas-table-projection.spec.ts's resize test no-ops on CI runners
(synthesized pointermove deltas coalesce; expected >537px, received
460 = zero growth) while passing locally 3/3. CI skips the gesture
via test.skip; the behavior stays covered by TestSetCardSize (Go)
and the local run. Leave by fix (a deterministic resize driver) or
review-date decision.

## composition-canvas-interactions: process-inject-text Inspector compose
- Class: local canvas geometry (the same runner-geometry class the
  test already CI-skips itself for).
- Entered: 2026-08-21 (deterministic on the dev machine this day,
  main and feature branch alike -- node actionability never settles
  on the first Inspector click; unrelated to the 0153 clipboard
  change it surfaced under).
- Review: 2026-09-04. Fix shape: the spec's own pane-aware
  click/stability fixtures, or promote its CI-skip reasoning to a
  documented manual check if geometry keeps drifting.
