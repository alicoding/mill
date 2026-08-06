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
recipe's step sequence, session-identity resolution across tab/agent/
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
  a "step" is for Mill specifically — one shell command? A whole recipe?),
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
