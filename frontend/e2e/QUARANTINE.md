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
| decision-outcome.spec.ts:132 | live-run | 2026-08-26 | 2026-09-26 | second live-run sighting in this file (:192 already registered): pinned-arm test hit CI-load timeout once on an unrelated PR (#472's run), passed on retry #1, 5/5 green locally -- same SUCCESS-status-polling class |
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
| atlas-delete-relationships.spec.ts:10 | interaction-race | 2026-08-24 | 2026-09-24 | openCard's own click-to-select `toPass` retry loop (fixtures/atlasBoard.ts:141, goal 0134's shard-1 cluster) hits the full 25s CI budget rather than resolving slowly -- both observed CI failures timed out at exactly the ceiling (25.6s, 25.8s), same shard position both times, then passed in ~2.6s on retry. That recovery speed argues for a one-off stuck click, not sustained CPU throttling a bigger timeout would durably fix. Same shared-helper-timeout shape as composition-canvas-interactions.spec.ts:25's clickCanvasNode entry; root cause not yet traced |
| atlas-table-object.spec.ts:103 | interaction-race (contention-only) | 2026-08-25 | 2026-09-25 | the frame-drag test's own drag hit the full 60s CI ceiling twice, both times in e2e shard 1/4 alongside this same shard's atlas-delete-relationships.spec.ts:10 entry above AND a genuinely failing neighbor test retrying twice in the same run (goal 0226's own round-trip spec, fixed same-day) -- passes clean in 6/6 local `--repeat-each` runs across both CI attempts and shares no fixture/code path with either neighbor, so shard-level resource pressure from the neighbor's retries is the working theory, not a defect in the drag itself; revisit if it recurs without a stressed neighbor in the same shard |

## Go tests (goal 0228)

This register covers Go, not only Playwright — same protocol, same
two-strikes rule (testing.md's flake protocol). Identity is
`package/file.go:line` since Go has no spec-file convention; classes
reuse the taxonomy above where the shape matches (a Go test polling a
real workflow run's terminal status is the same **live-run** class as
the Playwright entries).

| Package:line | Class | Entered | Fixed | Notes |
|---|---|---|---|---|
| internal/services/triggersvc/filewriteguard_test.go:187 | live-run | 2026-08-25 | 2026-08-26 | `TestFileWatchCycleGuard_DifferentWorkflowWatchingSameFolder_StillFires` asserted on a triggered run's mere row existence, not its terminal status, so under CI load the test (and its `t.Cleanup`, which closes the execution DB) could return while the run was still PENDING -- two sightings the same day, both on PRs that never touched the package, with `GetEvent() timeout` warnings and a `sql: database is closed` error riding along as the DB closed under the still-running workflow. Fixed by polling for the run's own terminal SUCCESS status before returning (`waitForTriggeredRunSuccess`), applied to both cycle-guard tests in the file since they share the identical race shape |
| internal/services/triggersvc/savedpage_seed_test.go:37 | live-run | 2026-08-26 | 2026-08-26 | `TestSeededSavedPageToMarkdown_FiresRealWorkflowAndExtractsMainContent`: same class as the row above, one file over -- the test returned as soon as the process step's checkpoint proved out, while the run's later apply step was still mid-flight, so cleanup closed the execution DB under the live workflow (race detector + `sql: database is closed` on #465's test-go, a PR that never touched the package). Class-level fix shape reapplied, with one twist: this test deliberately tolerates the apply step failing on headless CI, so it waits for the run's terminal status (SUCCESS or ERROR), not success specifically |
| internal/adapters/clipboard/clipboard_test.go:70 | real-pasteboard contention | 2026-08-28 |  | `TestWatchChanges_FiresOnRealChange` polls the ONE real macOS pasteboard; a concurrently running Mill instance (the installed app, `task dev`, or an e2e server) writing the clipboard between the test's write and its poll makes the observed change-count miss -- ~1-in-3 under load, passes in isolation, reproduced on unmodified main by two independent agents the same day (second strike). Candidate class fix: skip when another mill process is detected, or a change-token equality check instead of a count; until then, a local failure here with a live Mill running is the environment, not the change |

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

## atlas-pencil-tool.spec.ts: Space-to-pan after arming via the Annotate drawer (goal 0224) -- RESOLVED (goal 0242)
- **Class (reclassified)**: local canvas geometry, not overlay-
  interaction -- the same class `atlasEmptyRegion.ts`'s own header
  names (goal 0223), not a focus/keypress defect. See goal 0242 for
  the full root-cause trail.
- **Root cause**: the fixme test's drag-start point was a fixed
  50%/50%-of-board fraction. Arming Pencil via the Annotate drawer
  settles React Flow's own fitView at a different pan/zoom than a
  direct click, and at that settled fit the fixed point landed on a
  seeded card's own node instead of the empty pane -- a pointerdown on
  a node is captured by that node's own drag/selection handling and
  never reaches the pane's pan machinery, which is correct React Flow
  behavior, not a Space-to-pan regression.
- **Disproven** (live evidence, not assumption): Primer's
  AnchoredOverlay auto-focuses the style panel's first swatch button
  on both the failing (drawer) and working (direct-click) arming
  paths identically -- forcing that same focus state outside the
  drawer entirely still pans correctly, so focus/AnchoredOverlay/
  useKeyPress timing was never the mechanism.
- **Fix**: the test now derives its drag-start from
  `findEmptyBoardRect` (`fixtures/atlasEmptyRegion.ts`) instead of a
  fixed fraction, un-fixme'd and green standalone and in the full
  spec.

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
