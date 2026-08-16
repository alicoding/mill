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
| live-run-state.spec.ts:87 | interaction-race | 2026-08-16 | 2026-09-01 | synthetic pointer drag — fix in the 0080 burn-down |
| atlas-scale.spec.ts (first attempt) | interaction-race | 2026-08-16 | 2026-09-01 | boundingBox-after-animation — fix via settle helper in the burn-down |
| step-detail-overlay.spec.ts:99 | interaction-race | 2026-08-16 | 2026-09-01 | settle helper exists in-file; promote + apply |
| state-persistence.spec.ts:74 | unclear | 2026-08-16 | 2026-09-16 | reload/IPC timing; await first trace |
| configure-lists.spec.ts:105 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| quick-panel.spec.ts:132 | unclear | 2026-08-16 | 2026-09-16 | cross-document nav; await first trace |
| atlas-projections.spec.ts:108 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| workflow-lifecycle.spec.ts:52 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| workflow-runs-panel.spec.ts:116 | unclear | 2026-08-16 | 2026-09-16 | await first trace |
| layout.spec.ts:163 | unclear (contention-only) | 2026-08-16 | 2026-09-16 | fails only under parallel local load |
| composition-canvas-interactions.spec.ts:92 | CI-only skip | 2026-08-15 | goal 0069's revisit clause | the one honest skip; four fix layers recorded |
