# ADR-0008: Single execution path — every workflow run goes through DBOS

## Status
proposed

## Context

Raised directly by the user, prompted by working out how a Child
Workflow node (§3.3, still unbuilt) should execute: DBOS's real
parent/child tracking (`ParentWorkflowID`, workflow-ID-as-idempotency-
key, `WithCancelChildren`/`WithDeleteChildren` cascading) only exists
for workflows run through `RunWorkflowDurable` — the plain canvas "Run"
button (`CompositionService.RunWorkflow` → `composition.ExecuteWorkflow`)
never touches DBOS at all. That would have forced Child Workflow to be
either durable-only (with the plain Run button rejecting it) or to grow
a second, weaker in-process fallback — and the user challenged whether
that fork should exist at all, calling it out as "supporting a
fragmented architecture."

Checked directly, not assumed: the fragmentation is shallower than it
looks. There is exactly one graph-walking engine
(`composition.executeWorkflow`, `internal/domain/composition/execute.go`).
`ExecuteWorkflow` *is* that engine called with a no-op `directStepRunner`
that skips checkpointing; `ExecuteWorkflowWithStepRunner` is the same
engine with a real `StepRunner`. So the two "paths" were never two
engines — the fork is entirely at the service layer:
`CompositionService.RunWorkflow` calls the engine directly (no DBOS
context, nothing persisted, no workflow ID), while
`ExecutionService.RunWorkflowDurable` wraps the same engine in a single
DBOS-registered function (`ExecutionService.runWorkflow`) that
checkpoints every node as a step. This makes the actual fix a caller-
level change, not an engine rewrite.

The deeper problem this surfaces: any future capability built on DBOS
primitives (Child Workflow now; Parallel Steps' `WithWorkerConcurrency`
queue later, per §3.3's own capability map) only works on the durable
path by construction. Each one either has to special-case "requires
durable" or grow its own in-process shadow implementation. That pattern
repeating per-capability, not a one-off Child Workflow question, is the
real argument for collapsing to one path now rather than deferring it
again.

## Research summary

- **n8n**: confirmed directly (not assumed from memory) that manual and
  triggered executions run through the *same* execution engine — the
  only difference is metadata (manual executions don't count against
  execution quota; a "save manual executions" setting controls whether
  they're retained), not a second engine or a different capability set.
  ([docs.n8n.io](https://docs.n8n.io/workflows/executions/manual-partial-and-production-executions/))
- **[decisioning-vendor]** (the reference no-code decisioning platform named
  generically elsewhere in this doc per its own standing no-vendor-names
  rule, named directly by the user in this discussion): offers a "test
  run" within a workflow — draft or already-live — that takes a payload
  and runs it through the real engine, but is explicitly excluded from
  counting as a real triggered event. This is the same "one engine,
  classify after the fact" shape as n8n's manual/triggered split,
  independently arrived at by a second platform, and confirms SPEC.md
  §3.2's own already-`OPEN` "per-record test harness" line ("lets you
  test one record via a Form or raw JSON before trusting a full run")
  as a real, converged pattern rather than a one-off idea.
- [decisioning-vendor]'s test-run payload is **auto-generated from the workflow's own
  declared schema**, not manually typed by default — you get a filled
  form you can submit as-is, or edit specific fields before submitting.
  Checked against Mill's own code: this is *already built*, just scoped
  one level too narrow. `frontend/src/configSchema.ts`'s
  `generateSamplePayload`/`configFieldsToZodSchema` (zod +
  `zod-schema-faker`, adopted per §3.4) auto-fills a form from a
  **NodeType's** `ConfigFields` today (the Inspector's existing
  "Generate test payload" button, used for trigger config like a cron
  string). `composition.AttributeDef{Key, Label, Type}` already reuses
  `ConfigFieldType` (`types.go:128-132`) specifically so a workflow's
  Attribute schema and a node's config fields are "the same kind of
  name+typed-value declaration" (the field's own doc comment) — its doc
  comment already anticipates this exact use ("what a generated test
  payload (§3.4) can seed"). Extending the existing mechanism to
  `AttributeDef[]` is a thin adapter, not new design.

## Decision drivers

- `.claude/rules/architecture.md`: don't maintain two implementations of
  the same concern when one already subsumes the other — the plain-Run
  path is (and always was) a strict subset of the durable path's
  capability, not a peer with a different, deliberate purpose.
- CLAUDE.md: don't silently resolve an `OPEN` capability-map gap
  (Child Workflow) by inventing a second execution mode just to avoid
  touching the existing plain-Run path.
- SPEC.md §3.2's already-recorded "per-record test harness" gap and
  §7's execution-visibility work (Runs page) should converge on one
  mechanism, not grow a third.

## Decision

### 1. One execution path: every workflow run is a DBOS run

`CompositionService.RunWorkflow` stops calling
`composition.ExecuteWorkflow` directly. The app has exactly one Run
entrypoint going forward — the machinery `ExecutionService` already
built (`runWorkflow`, `RunWorkflowDurable`) becomes the only way a
workflow executes in the running app. `composition.ExecuteWorkflow`
(the bare, checkpoint-free engine call) stays in the codebase as the
tested *primitive* — `execute_test.go` and friends keep using it
directly, since a fast, DBOS-free call is the right shape for a unit
test — but no Wails-bound service calls it anymore.

Practical effect for the user: no behavior change to the canvas "Run"
button's feel — `RunWorkflowDurable` already blocks on
`handle.GetResult()` before returning, matching the plain path's
existing synchronous UX. What changes is that every run now gets a real
workflow ID, checkpointed steps, and a row on the Runs page — strictly
more visibility, not less.

### 2. `RunKind`: `test` vs `triggered`, not two engines

`runInput` (`executionservice.go`) gains a `Kind` field:
`"test"` for a run started from the canvas/Configure with an explicit
or auto-generated payload; `"triggered"` for anything started by a real
external event (today: none — every current entrypoint is manual;
`trigger-hotkey`/`trigger-schedule`/`trigger-clipboard-watch`/
`trigger-filesystem-watch` firing headlessly all become `"triggered"`
once `TriggerService` is wired to call the same `RunWorkflowDurable`
path instead of whatever it does today — a follow-on change, scoped
out of this ADR). `RunSummary`/`RunDetail` surface `Kind`; `RunsView.tsx`
gets a `Kind` filter, reusing the exact Source/Outcome filter pattern
Activity already established (§2.2) rather than a new UI concept.

`Kind` travels in `runInput` alongside `WorkflowID`/`Nodes`/`Edges`/
`Attributes` — the existing pattern every other per-run value already
uses (see `decodeAny[runInput]` in `executionservice.go`). DBOS does
have a native `SetWorkflowAttributes(ctx, workflowID, map[string]any)`
mechanism for tagging arbitrary metadata onto a workflow, which was
considered as the "more DBOS-native" alternative — rejected for v1:
it's a second, separate write after `RunWorkflow` starts (a
distinct call, not part of the same input struct), and `runInput`
already proves out to be the simplest path for every other run-scoped
value this codebase has needed so far. Revisit only if a real need for
querying/filtering *inside* DBOS itself (rather than in Mill's own Go
code after `ListWorkflows`) shows up.

### 3. Auto-generated test-input form, reusing the adopted pattern

A new `attributesToZodSchema`/`generateSampleAttributes` (or a thin
generalization of the existing `configFieldsToZodSchema` to accept
`{Key, Type}` rather than a full `ConfigField`, since `AttributeDef`
is a strict subset) mirrors `configSchema.ts`'s existing function
exactly, against `Workflow.Attributes` instead of a node's
`ConfigFields`. Triggering a "test run" (from the canvas, or a future
Configure-side single-record harness per §3.2) auto-fills every
declared Attribute via `fake()`, presented as an editable form
(matching the Inspector's existing `payloadNonce`-remount pattern) —
submit as-is for the common case, or override specific fields first.
This is the concrete answer to §3.2's "lets you test one record via a
Form... before trusting a full run" line, closing that `OPEN` item.

### 4. Child Workflow's execution-mode question dissolves

With one path, a Child Workflow node's `dbos.RunWorkflow(ctx, ...)`
call always executes inside a real DBOS workflow context — there is no
"what happens on the plain Run button" case to design for, since that
button no longer exists as a distinct code path. The Child Workflow ADR
(separate, still to be written) only needs to cover the trigger/input
question already discussed in this conversation (a dedicated
`trigger-callable` NodeType decoupled from real-event triggers, reusing
Attribute-binding for input), not an execution-mode branch.

## Alternatives considered

- **Keep both paths, document the split.** Rejected: this is the status
  quo, and it's the thing that surfaced the problem — every DBOS-native
  capability added from here on repeats the same fork-or-shadow-
  implement choice Child Workflow just hit.
- **Keep the plain path for canvas authoring speed, add DBOS only for
  "real" runs.** Rejected on the evidence gathered: n8n and [decisioning-vendor] both
  converge on one engine with runs classified after the fact, not two
  engines split by intent — and Mill's own plain path was never actually
  faster in a way that's been measured, just assumed. See Consequences
  for the actual perf check this still owes.

## Consequences

- **Locks** (pending your review — not yet implemented): one execution
  entrypoint (`ExecutionService`-owned) for the running app;
  `composition.ExecuteWorkflow` demoted to test-only internal primitive;
  `RunKind` (`test`/`triggered`) as a `runInput` field, not a DBOS
  `SetWorkflowAttributes` call; the test-input form as a generalization
  of `configSchema.ts`'s existing zod-schema-faker mechanism.
- **Real cost, not yet measured**: every run now does a SQLite write per
  checkpointed step instead of a pure in-memory call. Bounded and local,
  but needs an actual timing check against Mill's real node counts
  before this is called done — not assumed fine because it's "just
  SQLite."
- **Test/e2e impact**: `composition.spec.ts`'s existing Run-button
  coverage needs re-verification against the new call path (expected to
  look identical from the UI, since `RunWorkflowDurable` already blocks
  synchronously) — not just assumed to still pass.
- **Follow-on, explicitly out of scope here**: wiring `TriggerService`'s
  headless listeners (hotkey/schedule/clipboard-watch/filesystem-watch)
  to run through this same path with `Kind: "triggered"` — today they
  don't call either execution path in a way this ADR's audit covered;
  confirm their actual current call path before assuming this is a
  trivial relabel.
- **Unblocks**: the Child Workflow ADR, which no longer carries an
  execution-mode design question.
