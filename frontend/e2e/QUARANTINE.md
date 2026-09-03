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
| decision-outcome.spec.ts:132 | live-run → FIXED 2026-09-02 | 2026-08-26 | — | third CI sighting (2026-09-02, #585 shard 5): the reached terminal card's probe points all landed on the run bar / minimap overlays on the runner's taller layout (`dblClickReachedTerminal`), NOT the SUCCESS poll; the helper now zooms out and re-measures. Passed 12/12 under 4x throttle before the fix, which is what said it was geometry, not load |
| mcp-write-staleness.spec.ts:21 | live-run | 2026-08-16 | 2026-09-16 | real MCP round-trip |
| guardrail.spec.ts:238 | live-run | 2026-08-16 | 2026-09-16 | approve/deny resolve polling |
| state-persistence.spec.ts:74 | unclear | 2026-08-16 | 2026-09-16 | reload/IPC timing; await first trace |
| configure-lists.spec.ts:105 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| quick-panel.spec.ts:132 | unclear | 2026-08-16 | 2026-09-16 | cross-document nav; await first trace |
| atlas-projections.spec.ts:108 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| workflow-lifecycle.spec.ts:52 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| atlas-slots.spec.ts:59 | unclear | 2026-09-01 | 2026-10-01 | second same-day sighting, BOTH failing all retries under CI shard-6 load (main run 07:35Z after #550's merge: toHaveCount mismatch; PR #558's run 19:45Z). Not reproduced locally; traces auto-captured on retry -- read the newest trace before theorizing. Register-only entry: retry-passing is not a fix and neither sighting recurred on a rerun of the same commit. THIRD sighting 2026-09-02 on PR #569's shard 6 (flaky: failed first attempt, passed on retry), FOURTH the same morning on PR #571's shard 6 failing all three attempts (a rerun of the shard passed -- the change under test never touched linking) alongside first-ever sightings of atlas-linking.spec.ts:27 and atlas-single-space-trap.spec.ts:34 in the same shard -- a shard-6 load cluster; those two stay unregistered until a second strike |
| atlas-linking.spec.ts:27 | unclear (shard timeout) | 2026-09-03 | 2026-10-03 | SECOND strike (first: PR #571's shard 6, 2026-09-02, in the load cluster above): PR #624's shard 9 failed it at 1.5 min, all attempts, alongside a first sighting of atlas-authoring.spec.ts:30 (the sticky's typed text never appeared -- goal 0296's editor-typing class; that row stays a first strike). Chased per the throttle protocol: both specs 9/9 green locally at E2E_CPU_THROTTLE=4 with retries=0, so not a load race -- look at state leak / order dependence on the shard (both specs spawn dedicated servers; the 1.5 min is a step timeout, not an assertion). Read the shard's trace before theorizing further. |
| resizable-table.spec.ts:158 | local-only-red (env divergence) | 2026-09-01 | 2026-10-01 | deterministic 2px scrollWidth overflow on the Workflows table, LOCAL ONLY: 3/3 `--retries=0` failures on this machine AND identical failure on a clean origin/main worktree, while #548's CI e2e ran it green the same night -- so main is green in CI and red here (0264's local-red class, second instance). Likely font-metric/environment divergence in column sizing; not chased at recording time RESOLVED 2026-09-03: the class is platform font metrics -- the table is a CSS grid whose tracks size from glyph widths, and `system-ui` resolves to San Francisco on macOS and to the runner's Linux face in CI (nothing in Primer's stack is bundled), so six fractional tracks sum a few pixels apart per OS; forcing monospace moved the overflow to 78px, proving the source. Fix: the assertion tolerates 8px (the bug it guards was tens of pixels); bundling a font was rejected as a UI-wide change out of a flake's scope. |
| atlas-table-projection.spec.ts:135, atlas-table-object.spec.ts:68 (was :74), atlas-table-glide.spec.ts:121 | interaction-race (grid rename-overlay lifecycle) | 2026-09-02 | 2026-10-02 | UPDATE 2026-09-03 (goal 0287 S3): :135's "committed cell edit left unwritten" sub-symptom was NOT this race -- the card page's Dialog focus trap kept the body-level overlay editor from ever holding focus (fixed: ListGridGlide's editorPortal='host'); :135 is green in order now. The add-columns auto-open (:68) missed three times in a full in-order run and passed ×3 alone the same hour -- order-dependent, mechanism still the RenameOverlay lifecycle below. New manifestation post goal-0287-S2 migration onto the adopted grid, superseding atlas-table-projection.spec.ts's original :108/:179/:408 hand-rolled-grid sightings on this row (:179 now reads pill data off the accessibility DOM instead of a visible pill, :408 was deleted as a duplicate of atlas-table-glide.spec.ts's own arrow-key test). All three sightings share ONE mechanism -- ListGridGlideMenus.tsx's RenameOverlay/openRename (anchored via `gridRef.current.getBounds`) -- but three different symptoms: :135 (card-page overlay, inserting into a List with ZERO existing columns -- the only spec that does, since ListGridGlide's DataEditor doesn't mount until columns.length > 0) either never opens the rename input or opens it sized to roughly the whole grid instead of the header cell, and separately can leave a committed cell edit unwritten (`editGlideCell`'s own `#portal` editor staying mounted after Enter); :74 (atlas-table-object.spec.ts, an already-mounted grid, no overlay, goal-0287-S1 code unmodified by this migration) missed the auto-open once on the third of four sequential add-column calls, clean on an isolated retry; :121 (atlas-table-glide.spec.ts, goal-0287-S1 code unmodified by this migration) hit "element was detached from the DOM, retrying" mid-`fill()` on the MENU-triggered rename (not auto-open) under `E2E_CPU_THROTTLE=4`, its first-ever throttled run. The overlay-context/empty-list angle in :135's original note doesn't hold given :74 and :121 reproduce it in already-mounted, non-overlay, non-empty grids too -- this is the RenameOverlay's own lifecycle (mount timing against the grid's async layout, or the 150ms projection refetch racing the anchor read), not a first-mount or overlay-specific gap. Not chased into `ListGridGlideMenus.tsx`'s `RenameOverlay`/`openRename`/`anchorFromBounds` at recording time -- read the retry trace before theorizing |
| atlas-folder-import.spec.ts:33 | lazy-engine-wait → FIXED 2026-09-02 | 2026-09-02 | — | three CI sightings in one day (the mermaid diagram never counted in the overlay); instrumented under 4x throttle: the render completed AFTER the default 5s expect expired (the engine is a lazy chunk loaded once the prose mounts). Assertions now carry 30s; 16/16 at 4x. Class note: any assertion on a lazily-loaded engine's output (mermaid, draw.io, pdf, CodeMirror) needs engine headroom, not the default wait |
| docs-view.spec.ts:137 | local-only-red (env divergence) | 2026-09-03 | 2026-10-03 | `docs.search browses every page when the query is empty` -- the palette dialog never appears after the command runs, 3/3 `--retries=0` locally on a clean origin/main base (3e9e1b1f) with and without the same session's CSP change (attributed by stashing it), while CI ran it green (one flaky-then-pass on PR #616's shard). 0264's local-red class, third file; not chased at recording time -- read the retry trace before theorizing |
| atlas-note-formatting.spec.ts:143 (and note-markdown.spec.ts's typing tests; runtime-plugin-doors.spec.ts:102 the Board index note, added 2026-09-03 after four local sightings in one session -- "ow"/"owCall the bank" for "Call the bank", the same per-keystroke loss under render load) | interaction-race (typing under render load) → :143 FIXED 2026-09-03 | 2026-09-01 | 2026-10-01 | :143's mechanism measured under 4x throttle (goal 0296): after the `[x] ` conversion the list-item widget remounts asynchronously and a per-keystroke sequence loses its TRAILING key ("buy mil"); the test's own retype-recovery then landed the retyped text in a NEW item, which is the "2 unchecked" the flake reported. The item text is now inserted atomically (the conversion keystrokes stay real): 4/4 at 4x, was 2/3 failing. Engine note for any future per-keystroke typing right after a conversion: the remount is upstream (the list-item node view), not the sticky. The Board index row keeps its atomic-insert marker (3/3 at 4x on the same day) RESOLVED 2026-09-03 (goal 0316, the class): the loss was never the editor -- a rebuild of the board's node array (AtlasBoard's wholesale setNodes on any allNodes change) handed React Flow fresh node objects without `measured`; a sticky declares no height, so React Flow rendered it `visibility: hidden` for a frame until its resize observer reported, and Chromium moves a caret inside hidden content to the editing host's start -- the next keystroke landed at the top of the note. Pinned by a keystroke-by-keystroke probe (focus, Selection API, DOM mutations, the node wrapper's style) under 4x throttle. Fix: `carryMeasured` keeps the previous measurement across rebuilds. The overlay editor never lost a keystroke (4/4), which split the engine from the node context. |
| atlas-containment.spec.ts:136 | interaction-race | 2026-08-17 | 2026-09-22 | the Area tool's own marquee draw (a real pointer-capture drag, not React Flow's own node drag) occasionally no-ops -- CONFIRMED real and reproducible again 2026-08-22 (2/22 local `--retries=0` runs, self-heals on retry every time observed), on the SECOND marquee in the file (marker-box grouping), not only "the last" as first logged. CONFIRMED a DIFFERENT mechanism than the drag-file entry this same line used to be conflated with (see "Fixed" below): this marquee's start/end points are both on open canvas, nowhere near the board's fixed corner chrome (minimap/creation tray/zoom controls) at the moment it fires -- checked directly against a passing run's own screenshot. waitForViewportStable already applied at every zoom-changing step; root cause within the Area tool's own pointer-capture handling not yet isolated |
| workflow-runs-panel.spec.ts:116 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| layout.spec.ts:163 | unclear (contention-only) | 2026-08-16 | 2026-09-16 | fails only under parallel local load |
| atlas-folder-import.spec.ts:113 | unclear (contention-only) | 2026-08-18 | 2026-09-18 | "Add 1 cards" click times out only under 4-worker parallel local load (own dedicated server, so not a cross-spec data race); passes clean in isolation and on retry every time observed |
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
| composition-canvas-interactions.spec.ts:25 (and its :92 CI-only-skip sibling entry) | occluded-drag-start, SECOND STRIKE | 2026-08-31 | goal 0264: MEASURED root cause -- clickCanvasNode's fixed bottom-center pan anchor landed ON the MiniMap once the Inspector narrowed the pane below ~2x the MiniMap width; a MiniMap drag pans INVERTED and amplified, so each retry's 8-chunk pan flung the graph ~1150px off-pane deterministically (instrumented transforms: translate -969px after a +181px intent). Same class as the 2026-08-22 hittablePointOn entry above: a press at an assumed coordinate whose real hit-test target was chrome. Fix at the shared site: the anchor is now elementFromPoint-verified to target the pane itself, re-picked per chunk. The goal-0069 "CI-only" skip was this same collision at CI's narrower pane geometry -- skip REMOVED in the same change, proven by the PR's own CI e2e. 21/21 local `--retries=0 --repeat-each=3`, 34/34 across ten consumer suites |
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
