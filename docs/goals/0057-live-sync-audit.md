# 0057 — Live-sync audit: no surface ever needs a reload

**Raised:** 2026-08-14, owner-directed after hitting the runs-panel
staleness live ("the problem is that it is not real time — why do we
have to reload our app ever in any part; can we now look at other
parts of the app to make sure we don't have similar issues").
Queue position: ahead of 0052 (owner-picked by asking now).

## The bug class this generalizes

The runs-panel instance (fixed in its own PR, with regression test
`TestRunWorkflow_EmitsRunDataEventOnStartAndCompletion`): a surface
fetches once on mount, stays mounted across tab switches, and relies
on `mill-data-changed{entity}` to refresh — but one or more mutation
paths for that entity never emit. Result: data a user watches goes
stale, or appears empty, until a full app reload. Goal 0017
established the event and swept the then-known surfaces; this goal
audits systematically instead of waiting for the next live hit.

The principle (goal 0017's, now stated as the app-wide invariant):
**a user must never need to reload Mill to see the current state of
anything the app displays.** Every displayed collection/state either
(a) subscribes to the entity events its data derives from, with every
mutation path emitting them, (b) deliberately polls (the in-flight
run detail's honest-only-path pattern), or (c) is provably immutable
for the session. Anything else is a gap.

## Plan

1. **Inventory (delegated, read-only):** complete matrix of
   emitters (`dataevent.Emit` + other Go→frontend events), frontend
   `Events.On` subscribers, fetch-once-no-subscription components,
   and mutating service methods without emits.
2. **Judgment pass (main session):** classify every candidate as
   real gap / deliberate poll / session-immutable, recorded in this
   file. Surfaces where the entity string doesn't exist yet get one
   named (the dataevent entity vocabulary is the contract).
3. **Fix the real gaps** — emits at mutation chokepoints (the
   runs-panel fix's shape), subscriptions where a panel listens to a
   subset of its entities; each fix carries a TestHook-seam
   regression test per testing.md. Cluster into one PR if small,
   or per-surface PRs if not.
4. **Prevention:** extend the goal-0017 per-service emit-test
   pattern to any mutating service that has none, so a future
   mutation path can't land emit-less unnoticed. No new framework —
   the dataevent seam already exists; this is coverage, not
   machinery.

## Acceptance (checkable)

- [x] The inventory matrix (or a distilled gap table) is recorded in
      this file, every fetch-once surface classified as
      gap / deliberate-poll / session-immutable with a reason.
- [x] Every classified gap is either fixed (emit + subscription +
      regression test at the TestHook seam) or explicitly rejected
      with a reason recorded here.
- [x] Every mutating service package has emit coverage in its tests
      for the methods that mutate displayed state. Confirmed complete
      across every service package with a `dataevent.Emit` call site:
      executionsvc, triggersvc, settingssvc, mcpsvc (this goal's own
      scope), guardrailsvc (already covered pre-goal), and — closing
      the two gaps a full sweep found while verifying this box —
      compositionsvc's `ResetWorkflowToSeed`/`RestoreWorkflow`
      (`compositionservice_seedlifecycle.go`, now covered by
      `TestDataEvent_SeedLifecycleMutations`) and configuresvc's
      `CreateAIProvider`/`UpdateAIProvider`/`DeleteAIProvider`
      (`configureaiprovider.go`, now covered by
      `TestDataEvent_AIProviderMutations`). No mutating service package
      has a `dataevent.Emit` call site left without a `TestHook`-seam
      test.
- [ ] No surface in the app requires a reload to reflect a mutation
      Mill itself performed — spot-checked live on at least the
      surfaces the inventory flagged most suspicious.

## Audit verdict

Every candidate from Cluster A (run-lifecycle emits) and Cluster B
(hotkey/keybinding vocabulary), verified against the code before
fixing per this goal's own instruction — none of the candidates turned
out to be a non-gap on inspection.

| Surface / method | Classification | Where the fix landed |
|---|---|---|
| `ExecutionService.ResolveApproval` | fixed — a parked run's resolution changed its user-visible state immediately but no emit fired until the resumed graph finished | `internal/services/executionsvc/executionservice_guardrail.go` |
| `ExecutionService.CancelRun` | fixed — a run cancelled while still `ENQUEUED` never reaches `runWorkflow`, so its completion emit never fires for that run | `internal/services/executionsvc/executionservice_cancel.go` |
| `ExecutionService.RedriveRun` | fixed — the forked run enters DBOS via `ForkWorkflow` directly, bypassing `runWorkflowStart`'s own start emit | `internal/services/executionsvc/executionservice.go` |
| `app/CommandPalette.tsx` hotkey combo hints | fixed — fetched only on palette open, no subscription while the palette stayed open | `frontend/src/app/CommandPalette.tsx` |
| `app/QuickPanel.tsx` hotkey/keybinding hints | fixed — only refetched on window show/focus, not while the panel stayed open between shows | `frontend/src/app/QuickPanel.tsx` |
| `composition/hotkeyCapture.ts` `useComboCapture` (backs both `useHotkeyCapture` and `useCommandKeybindingCapture`, so also `NodeInspector.tsx`/`TriggerRowLabel.tsx`) | fixed — a target's own combo fetched once per mount/target-change, no subscription for a change made by a DIFFERENT open recorder instance | `frontend/src/composition/hotkeyCapture.ts` |
| `views/KeyboardShortcutsSection.tsx` | fixed — covered by the `hotkeyCapture.ts` hook fix (its own recorder's binding) plus `App.tsx`'s central router now refreshing `keybindingOverrides` (the `effectiveBinding` fallback prop) | `frontend/src/app/App.tsx`, `frontend/src/composition/hotkeyCapture.ts` |
| `TriggerService.AssignHotkey` / `UnassignHotkey` / `DebugAssignHotkey` | fixed — no `"hotkey"` entity existed at all | `internal/services/triggersvc/triggerhotkeyassignment.go` |
| `SettingsService.SetKeybinding` / `ClearKeybinding` | fixed — no `"keybinding"` entity existed at all | `internal/services/settingssvc/settingsservice_keymap.go` |
| Run step-by-step progress (an open run's own in-flight step list) | non-gap: deliberate poll — DBOS has no per-step push event to subscribe to | n/a |
| Run detail of the currently-selected in-flight run | non-gap: deliberate poll — same reason as above | n/a |
| `MillMCPService`'s own `dataevent.Emit` call sites (`run_workflow`, the four debug tools, `import_list`'s second-mutation emit) | verified emitting correctly all along — the gap was test coverage only (box 3), not a missing emit; the other `import_*` tools delegate to an already-covered compositionsvc/configuresvc emit and needed no change | tests only: `internal/services/mcpsvc/millmcpservice_dataevent_test.go` |

New `dataevent` entity strings: `"hotkey"` (ID = the workflow ID the
combo binds to) and `"keybinding"` (ID = the command ID the combo
overrides), documented in `dataevent.go`'s `Changed` doc comment.

Emit-coverage tests now exist at the `dataevent.TestHook` seam for
every mutator this goal touched:
`internal/services/executionsvc/executionservice_dataevent_test.go`
(`ResolveApproval`/`CancelRun`-while-`ENQUEUED`/`RedriveRun`, extending
the existing `TestRunWorkflow_EmitsRunDataEventOnStartAndCompletion`
pattern — mutex-guarded since the DBOS completion emit fires on a
different goroutine),
`internal/services/triggersvc/triggerhotkeyassignment_dataevent_test.go`,
`internal/services/settingssvc/settingsservice_keymap_dataevent_test.go`
(both following `compositionservice_dataevent_test.go`'s
`captureEmits` shape), and
`internal/services/mcpsvc/millmcpservice_dataevent_test.go` (three
tests against the real `StreamableClientTransport` harness
`millmcpservice_authoring_test.go`/`millmcpservice_debug_test.go`
already establish — `run_workflow`, all four debug tools across two
stepped sessions, and `import_list`'s own second-mutation emit;
mutex-guarded for the same cross-goroutine reason as executionsvc's).
The two gaps found while confirming box 3 (outside this goal's
original Cluster A/B scope, but closed in the same pass) are covered
by `TestDataEvent_SeedLifecycleMutations` (added to
`internal/services/compositionsvc/compositionservice_dataevent_test.go`,
reusing `compositionservice_seedlifecycle_test.go`'s own
`firstGoldenID` fixture) and
`TestDataEvent_AIProviderMutations` (added to
`internal/services/configuresvc/configureservice_dataevent_test.go`,
same `captureEmits` shape as its sibling entity tests in that file).
No frontend vitest precedent exists yet for asserting an
`Events.On('mill-data-changed', …)` refresh (no existing `*.test.tsx`
covers it for any prior surface either, including the already-shipped
`WorkflowRunsPanel.tsx` instance) — these Go tests plus the full
Playwright e2e suite are this change's proof, matching testing.md's
layering.
