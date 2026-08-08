# ADR-0004: Execution & process/session tracking (SPEC.md §6/§7)

## Status
proposed

## Context
SPEC.md §6 (execution environment & determinism) and §7 (process/session
tracking) are both `OPEN` and gate §2.1 (the M365 Copilot bridge, the
actual first real milestone) as much as the browser bridge does — a
guardrailed command needs somewhere durable to report its result to, or
the M365 loop just reproduces the original Hammerspoon failure by hand.

§7 already logs a concrete, sharpened requirement from a real production
incident (the prior Hammerspoon-based prototype, not Mill): a command
proposed by M365 Copilot edited Hammerspoon's own Lua config; Hammerspoon's
file-watcher fired an async hot-reload that tore down and restarted the
very process that was about to report the command's result back. The
result wasn't delivered late — it was silently lost, because the
reporting channel was tied to a process lifetime that didn't survive the
command's own side effect. This rules out any design where a result lives
only in an in-memory channel/callback scoped to one process's lifetime.

§1.2 already parked two unevaluated candidates for this: DBOS (a durable-
execution library, previously assumed to require a standalone Postgres
server) and pueue (already rejected — Rust, and a separately-installed
daemon, violating both the no-Rust and the embeddable-in-binary hard
constraints from §1.1/§1.2).

## Decision drivers
- Hard filter, already locked (§1.2, from the pueue incident): any
  process/job-queue mechanism must be embeddable directly in the Go
  binary — a library, not a separately-installed daemon/CLI, no
  dependency on an external package manager or database server at
  install time.
- §7's sharpened requirement above: must survive the launching process
  being killed by a side effect of the very command it ran, not just a
  normal exit.
- CLAUDE.md's no-phone-home constraint: zero outbound network calls not
  explicitly initiated by the user via a user-configured connector.
- Research → Plan → Implement: don't assume DBOS needs Postgres or that
  "nothing fits" — verify directly.

## Research

Dispatched to a research agent, independently re-verified below rather
than taken on the agent's word:

1. **DBOS Go SDK now ships a pure-Go SQLite backend.** Confirmed directly
   against `github.com/dbos-inc/dbos-transact-golang`'s `go.mod` (pulled
   live: `modernc.org/sqlite v1.54.0`, the cgo-free SQLite driver) and its
   docs: *"a system database: SQLite for zero-setup local development,
   PostgreSQL or CockroachDB for production."* Configured via
   `dbos.Config{DatabaseURL: "sqlite:..."}` plus a blank import of
   `dbos/driver/sqlite`. This closes the "requires Postgres" assumption
   §1.2 flagged as unverified — it doesn't.
2. **Alternatives surveyed and rejected as weaker fits, not disqualified
   outright:** River (Postgres-native queue; its SQLite driver is
   explicitly "experimental" per River's own docs, and it's a job queue —
   fire-and-track — not a durable-execution/checkpoint framework, so
   resuming a multi-step workflow is not its native shape); goqite
   (minimal SQS-style queue, pure Go, but Mill would still hand-write the
   status/result schema on top — closer to "storage primitive" than
   "solution"); asynq (requires Redis — same external-service problem
   pueue was rejected for, just a different daemon).
3. DBOS's dependency tree pulls in `pgx` (Postgres driver) and
   `gorilla/websocket` (its "conductor" remote-observability feature)
   **unconditionally at compile time**, even when only the SQLite backend
   is used — confirmed by `go build` failing without `go mod tidy`
   resolving those transitive imports. This is dead weight in the binary,
   not a runtime risk (see the phone-home check below), but worth naming:
   it's not as lean as a from-scratch SQLite table would be.

## Spike — verified empirically, not from docs alone

DBOS's SQLite backend is a 2026-vintage addition with no long production
track record, so before locking it in, a real spike was run (not just
read about) in a scratch Go module:

1. A workflow with two steps: `stepOne` (stands in for "run the
   guardrailed command to completion," returns a result) and `stepTwo`
   (stands in for "report the result back," e.g. paste to clipboard).
2. Process 1 runs `stepOne` to completion (its checkpoint is written to
   SQLite), then hard-exits (`os.Exit(137)`) — simulating the exact
   Hammerspoon shape: the command already fully ran, an unrelated async
   event then kills the process before the result is reported.
3. Process 2 (`go run` again, same workflow ID, same `spike.db`) launches
   fresh. Log output: `Recovered pending workflows count=1`. Crucially,
   `stepOne`'s body did **not** re-execute (a run-count file confirmed it
   stayed at 1, and its log line never printed on the second run) — DBOS
   returned the checkpointed result without re-running the command.
   `stepTwo` then ran for the first time and the workflow completed,
   delivering the result that would otherwise have been lost.
4. A prior version of the spike (crashing *inside* `stepOne`, before it
   returned) showed the opposite and equally important result: with no
   checkpoint yet recorded, resume **does** re-execute the step from the
   top. This is correct durable-execution semantics (at-least-once per
   step, not exactly-once) but it means **the guardrailed-command step
   itself must be written to be safe to re-run**, or structured so the
   OS-level command execution and result capture is atomic enough that a
   crash mid-command doesn't leave partial side effects — a real design
   constraint for whoever implements the `internal/domain/execution`
   package this ADR unlocks, not a flaw in DBOS.
5. **Phone-home check**: read `dbos.go`'s init path directly — the
   "conductor" websocket (the only outbound-network-capable code path in
   the SDK) only activates if `DBOS__CLOUD=true` is set or
   `config.ConductorAPIKey` is explicitly configured. Neither was set in
   the spike; no outbound connection was attempted. **Locking this as a
   rule below**: Mill's own config must never set `ConductorAPIKey` or
   `DBOS__CLOUD`, or this constraint silently breaks later.

## Decision

**Adopt `github.com/dbos-inc/dbos-transact-golang` with its SQLite driver
(MIT license) as the durable-execution substrate for §6/§7**, behind a
`internal/adapters/execution` port per CLAUDE.md's ports/adapters
discipline — Mill's own domain logic (what counts as guardrail-worthy, a
workflow's step sequence, session-identity resolution across tab/agent/
process) stays hand-written in `internal/domain/...` and only calls
through the adapter interface, so this dependency stays swappable if
DBOS's SQLite backend doesn't hold up under real use.

It is the only surveyed option with durable *workflow* semantics
(checkpointed steps, automatic resume, queryable status from a separate
process invocation via `RetrieveWorkflow`/`GetStatus`/`ListWorkflows`) out
of the box, pure-Go, no external database server, and it was verified —
not assumed — to satisfy the exact failure mode §7 exists to prevent.

## Consequences
- Locks: DBOS-Go + SQLite as the process/session persistence layer;
  `internal/adapters/execution` as a new port/adapter package wrapping
  it; a hard rule that `ConductorAPIKey`/`DBOS__CLOUD` are never set in
  Mill's own configuration (phone-home guard).
- Unlocks: §2.1's guardrailed command execution can now be designed for
  real (§8's guardrail preview gates entry into a workflow; the workflow
  itself is what this ADR provides); the "always-on HTTP interface" open
  question ADR-0003 left for §5/§7 can now be answered in terms of a
  concrete session/process model instead of in the abstract.
- Not decided here: the actual shape of `internal/domain/execution` (what
  a "step" is for Mill specifically — one shell command? A whole workflow?),
  how session identity (tab + agent run + process, per §7) maps onto a
  DBOS workflow ID, and whether the re-run-safety requirement from spike
  finding #4 needs a generic solution or is handled per-command-type.
  These are real design work for whoever implements this, not resolved by
  picking the library.
- Risk carried forward, not eliminated: DBOS's SQLite backend has no long
  production track record. The spike de-risks the specific failure mode
  §7 cares about, not general reliability under sustained real use —
  worth revisiting if DBOS's SQLite path turns out to have rough edges
  once Mill leans on it for real.

## Update — Mill workflow/step mapping designed, now implementing

Verified directly against the real `dbos-transact-golang` v1.0.0 API
(downloaded module source, not docs alone) before committing to this
shape — v1 renamed `DBOSContext`→`Context` since the spike above ran, so
type names below match the actual current release.

**Mapping: one Mill workflow *run* = one DBOS workflow instance; one Mill
graph *node* execution = one DBOS step.** This is the natural unit match
— DBOS steps are exactly the checkpoint granularity Mill's per-node
graph walk already has. Concretely:
- `composition.ExecuteWorkflow` (the existing, pure, in-memory node-graph
  walker — `buildGraph`/`findRoot`/`nextNode`, all unexported, stay
  exactly as-is) gains a new **additive** entry point,
  `ExecuteWorkflowWithStepRunner(nodes, edges, attrs, run StepRunner)`,
  where `StepRunner = func(stepID string, fn func() (ExecContext,
  error)) (ExecContext, error)`. The existing public `ExecuteWorkflow`
  becomes a one-line wrapper calling it with a direct-passthrough
  runner — every existing call site and test (14+ in `execute_test.go`
  alone) is untouched, zero behavior change for the non-durable path.
  Deliberately a **function parameter, not a package-level var** (unlike
  `SetConnectorLookup`/`SetListLookup`/`SetMCPServerLookup`, which are
  legitimately global singleton lookups) — a global step-runner would
  race across concurrent workflow runs (e.g. a schedule tick and a
  hotkey firing at once), which those lookup tables don't have to worry
  about since they're stateless resolution functions, not per-run
  execution wiring.
- `executionservice.go` (new, root package — this is orchestration
  policy over two domain-adjacent concerns, composition graphs and DBOS
  workflow IDs, so it lives at the same binding layer as
  `compositionservice.go`/`triggerservice.go`, per CLAUDE.md's
  storage-lives-one-layer-up rule) registers **one** DBOS workflow
  function, `runWorkflow(ctx dbos.Context, in runInput) (string,
  error)`, via `dbos.RegisterWorkflow` before `Launch()` (DBOS resolves
  a workflow by registered function identity for recovery, so this must
  be a single fixed function, never a per-call closure — closures
  aren't stable across a process restart anyway). Its body calls
  `composition.ExecuteWorkflowWithStepRunner(in.Nodes, in.Edges,
  in.Attrs, stepRunnerFor(ctx))`, where `stepRunnerFor` wraps each call
  in `dbos.RunAsStep(ctx, fn, dbos.WithStepName(stepID))` — `stepID` is
  the Mill graph node's own `ID`, so a later `dbos.GetWorkflowSteps`
  call can be joined straight back against `workflow.Nodes` by ID for
  the UI, no separate step-naming scheme to keep in sync.
- **`internal/adapters/execution`** stays composition-agnostic (mirrors
  `internal/adapters/mcpclient`'s shape: only this package imports
  `github.com/dbos-inc/dbos-transact-golang/dbos` directly, everything
  else in Mill imports `execution`'s own names) via a small `aliases.go`
  re-exporting the handful of DBOS types/generic functions Mill actually
  needs (`Context`, `WorkflowHandle`, `WorkflowStatus`, `StepInfo`,
  `ForkWorkflowInput`, `RegisterWorkflow`, `RunWorkflow`, `RunAsStep`,
  `ForkWorkflow`, `GetWorkflowSteps`, `ListWorkflows`) — same pattern
  DBOS's own `dbos/aliases.go` uses internally, not invented here. An
  `Adapter` type owns `New`/`Launch`/`Shutdown` and the SQLite DB path
  (`internal/adapters/settings`'s own config-dir convention,
  `execution.db` alongside `settings.json`).

**Redrive = `dbos.ForkWorkflow(originalRunID, startStep)`, not a
from-scratch Mill mechanism.** Verified directly (`ForkWorkflowInput`'s
real fields): a fork copies the original run's checkpointed step outputs
for every step before `StartStep` into the new forked workflow ID, then
re-invokes the registered workflow function from the top — steps before
`StartStep` hit their copied checkpoint and don't re-execute (the same
`RunAsStep` cache-hit behavior the original spike proved), steps from
`StartStep` onward run fresh. This directly satisfies the Oscilar/n8n
"fix forward from the failed step, not from step 1" pattern (§3.2) for
the case that matters most in practice: the failure was in the
*environment* the step called into (e.g. a connector's API key was
wrong), not in the payload itself — since `integration-http` etc.
resolve their Connector/List config live at execution time, not baked
into the checkpoint, a redrive naturally picks up a fix made on the
Configure page in between. **What this does not cover**: DBOS's
`ForkWorkflowInput` has no field to override the *original workflow
input* itself — there's no way to "edit the payload and rerun" via Fork
alone. Deliberately out of scope for the first pass (no user-facing need
identified yet beyond the fix-the-environment case above); a real future
feature if a workflow's own recorded input, not just downstream config,
turns out to be what needs editing before a redrive.

**Idempotency / re-run safety (spike finding #4), decided rather than
left to keep drifting**: a step that crashes mid-execution (as opposed
to returning cleanly, even with an error) re-runs from the top on
resume/fork — DBOS's documented at-least-once-per-step contract, not a
gap Mill is introducing. For Mill's existing node types this is
already safe by construction (`capture-clipboard-html`,
`process-html-to-markdown`, `apply-clipboard-write-*` are all pure
reads/deterministic transforms/idempotent writes) with one real
exception: `integration-http` with a non-idempotent method (`POST`
creating a resource) could in principle fire twice if the whole Mill
process dies between the HTTP call succeeding and the step's checkpoint
write completing. Deliberately **not** solved with an invented
idempotency-key layer in this pass — that's speculative infrastructure
for a failure window that's already narrow (a full process crash at that
exact instant, not an HTTP-level retry, which `go-retryablehttp`
already handles safely at the request layer) and no real workflow has
hit it yet (CLAUDE.md: don't build for a decision that doesn't exist
yet). Recorded here as a known, accepted tradeoff — revisit if a real
`POST`-heavy connector workflow makes this a live concern, most likely
by adding an explicit "idempotent" flag to `integration-http`'s config
that opts a step *out* of DBOS's retry-on-crash-recovery path via
`dbos.WithStepMaxRetries(0)` plus documentation, not by Mill inventing
its own idempotency-key protocol.

ADR-0006's "Status: proposed → accepted once implemented" precedent
applies here too — this ADR moves to `accepted` once
`internal/adapters/execution` + `executionservice.go` + the redrive UI
are built and verified end-to-end, not before.

## Lifecycle
- Owner: Ali (raised the hard filters this had to satisfy) + whoever
  implements `internal/domain/execution` next
- Maintains: the DBOS-Go/SQLite pick; the phone-home guard rule; the
  re-run-safety design constraint on future step implementations
- Update triggers: `internal/domain/execution` actually getting
  scaffolded; DBOS's SQLite backend hitting a real production issue;
  the always-on-HTTP-interface question (ADR-0003) getting resolved using
  this ADR's session model
- Last reviewed: 2026-08-06
- Review interval: 30 days while `proposed`; 365 days once `accepted`
