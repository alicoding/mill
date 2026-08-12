# ADR-0026: Code execution capability — environments, the code-block step, cancellation

## Status
accepted — explicit owner yes, 2026-08-10. Accepting resolves SPEC
§1.1's command-execution reading, §6 (environments as Configure
entities), and ADR-0023's global-vs-workflow guardrail placement, per
"What acceptance decides" below. Implementation is goal 0004.

## Context

SPEC §2.1's core loop (copy a code fence → hotkey → execute locally →
result back) and §6's environment questions have stayed open behind
everything else. ADR-0023 recorded the owner's pipeline model — typed
event input → ruleset → **code execution** → human review → terminal —
including two specifics: a running code step can't be cancelled without
a kill mechanism (then fails and is retryable), and code execution is
configurable globally AND at workflow level ("we need to think what the
global vs workflow model would be"). A dedicated research pass
(2026-08-10, primary sources: Go stdlib docs, the installed DBOS-Go
v1.0.0 source, real library repos) grounds every mechanism below.

## Research findings this design stands on

1. **Process-tree kill is a ~50-line stdlib hand-roll; no maintained
   library exists.** `exec.CommandContext`'s default cancel only kills
   the direct child (`os.Process.Kill`'s own doc: "only kills the
   Process itself"); a shell's grandchildren survive. The POSIX fix is
   one code path for macOS+Linux: `SysProcAttr{Setpgid: true}` at
   start, then `syscall.Kill(-pgid, SIGTERM)` → grace timer →
   `SIGKILL`, hooked through Go 1.20's `Cmd.Cancel`/`Cmd.WaitDelay`.
   Checked: `go-ps` archived, `gopsutil` has no kill-tree helper.
   Windows (Job Objects) is a named non-goal, consistent with SPEC's
   Windows-`PARKED` status.
2. **DBOS cannot interrupt an executing step — confirmed from source,
   not docs.** `CancelWorkflow` is a DB status write; its own comment:
   "Executing steps will not be interrupted." A live cancel needs the
   locally-held `context.CancelFunc` (from `dbos.WithCancel`) invoked
   in-process, with the step function written around
   `exec.CommandContext(stepCtx, …)`. So: Mill keeps its own
   `map[runID]context.CancelFunc` registry; a Cancel action calls the
   local func (the real kill) AND `dbos.CancelWorkflow` (the durable
   status record). Timeout and user-cancel funnel into the same kill
   path — one implementation, two triggers.
3. **No sandbox library fits macOS+Linux+no-daemon+not-deprecated**
   (go-landlock is Linux-only; sandbox-exec is Apple-deprecated;
   gVisor is a second runtime). This CONFIRMS §1.1's open lean with
   evidence: `os/exec` with explicit `Dir`/`Env`/shell-argv is the
   mechanism — ambient inheritance is literally the zero-value
   behavior being overridden — and the guardrail engine (ADR-0022) is
   the safety layer. Resolving §1.1's `OPEN` bullet this way is part
   of what acceptance decides.

## Design

### Execution Environment — a Configure entity (the "global" half)

`internal/domain/execenv.ExecEnv{ID, Label, Shell, Dir, Env}` —
1:many reusable (the §3.5 two-axis test: authored with room, referenced
by many workflows), CRUD'd like Lists/MCP Servers, picked via the
ADR-0009 entity picker. `Shell` is explicit argv (e.g. `/bin/zsh -c`),
`Dir` pinned, `Env` explicit-only (empty = clean env + PATH, never
inherited ambient). This is the global configuration surface the
pipeline model named.

### The code-execution node (the "workflow" half)

`code-execution` NodeType (KindProcess, **effect `external`** — the
ambient gate covers it automatically, ask-by-default, which IS §2.1's
guardrail gesture backed by the Review queue). Config: `envId`
(RefKind picker), `source` — `payload` (the captured code block flowing
in, the §2.1 case) or `literal` + a Multiline script field —
`timeoutSeconds` (default 120). Output: combined stdout+stderr becomes
the payload; non-zero exit fails the step (fail-safe, retry via the
existing redrive).

### Where guardrail config attaches (ADR-0023's open question, answered)

Both, via what already exists — no new mechanism: **global** = a
guardrail rule scoped to the `code-execution` node type or to one
ExecEnv (rule scope gains an `EnvID` field, one line in the matcher —
ADR-0019's connector-scope pattern applied to environments);
**workflow-level** = the existing workflow/step-scoped rule. Deny
always wins, unchanged. The rule-authoring UI returns as part of this
capability's Configure surface (it was parked pending exactly this
design).

### Cancellation & liveness

`internal/adapters/procexec` owns: process-group start, incremental
output (custom `io.Writer` fanning to buffer + live event — avoids the
documented `StdoutPipe`/`Wait` deadlock), SIGTERM→SIGKILL escalation,
timeout. `ExecutionService` gains the CancelFunc registry + a
`CancelRun` RPC surfaced on the Runs tab and Review queue ("stop this
run"). A cancelled step records `cancelled`, distinct from `failed` —
the pipeline model's fail-and-retry semantics ride the existing
per-step redrive.

### Seeded proof (the standing rule)

"Example: Run copied code" — clipboard-watch or hotkey trigger →
ruleset (block obviously destructive patterns as a DEMO of layering,
not a security claim) → human-review → code-execution (`echo`-grade
script against a seeded safe ExecEnv) → clipboard write. The §2.1 loop
minus the browser bridge, live.

## Amendment (2026-08-10, pre-implementation — owner-led, from direct
## production pain on the work machine's prior DBOS-based attempt)

Two design refinements plus a process-runtime baseline map, decided in
discussion before goal 0004 builds. The owner's reported failures
(shell/profile env breakage; "we went into DBOS handling it which is
wrong"; daemon/background-process trouble; multi-command runs where
"we don't know if it is stuck or still running, why it is taking long,
and if we need to kill it") each name a capability a mature platform
covers — mapped here so the build ships the platform, not just the
feature.

**Boundary statement, explicit:** DBOS owns workflow-state durability
(what completed, with what result). It supervises NOTHING alive — it
cannot kill, observe, or time out a running process (confirmed from
source; its own comment: executing steps are not interrupted).
Everything alive is `internal/adapters/procexec`'s job, full stop.
Conflating the two is the exact failure the owner already paid for.

**ExecEnv refinements ("materialize, don't inherit" — §1's thesis
applied to environments):**
- `Shell` becomes a typed choice (zsh/bash/sh), not free argv.
- New **Profile mode**: `clean` (no profiles; only the stored env —
  deterministic; DEFAULT, fail-safe) vs `login` (sources
  .zprofile/.bash_profile — terminal parity, less deterministic).
- **"Capture from my shell"**: one-click snapshot of the user's real
  PATH (and selected vars) into the stored, visible, editable env —
  determinism through materialization: clean mode AND your Homebrew/
  mise paths, because they're written down, never re-derived.

**Process-runtime baseline (beyond the original design):**
1. **Last-output-at + elapsed, live per step** — silence duration is
   the stuck signal ("running 4m · no output 3m"), not elapsed time.
2. **Idle timeout** (no-output-for-N) distinct from the hard timeout —
   CI's own pattern; kills the genuinely stuck without capping
   legitimately long jobs.
3. **Orphan policy**: the pgid is recorded durably BEFORE spawn; on
   startup Mill reaps leftover process groups from crashed runs.
   Daemonizing/background services are an explicit NON-GOAL (bounded
   commands only; services belong to launchd).
4. **Crash-mid-step recovery**: an un-checkpointed step re-executes on
   DBOS resume — for a command, that's double execution. procexec
   records "attempt started" durably pre-spawn; on recovery, an
   interrupted effectful step PARKS for a human decision (rerun /
   mark failed) instead of silently re-running. Fail-safe, §8's
   posture; at-most-once by default for effectful steps.
5. **Status vocabulary**: `cancelled` ≠ `failed` ≠ `interrupted` —
   three distinct recorded outcomes with distinct UI treatment.
6. **Concurrency guard**: per-workflow "don't start if already
   running" option (schedule double-fire protection); DBOS Queues are
   the eventual backing for real fan-out, not hand-rolled goroutines.

**Retry granularity & the intentional re-execution principle (same
discussion, owner-led from a no-code framework precedent — multi-
command runs tracked per command, retry-from-failure vs from-start as
a user option, re-execution always intentional):**
- **The canvas IS the command orchestrator — never a second one inside
  the node.** Per-command tracking/sequencing/parallelism inside one
  step's config would be a mini workflow engine hiding in a field (the
  §0 inner-platform trap). One command per node is the canonical
  shape: chaining = edges, parallel commands = the deferred Parallel
  node (§3.3, which now has its concrete driver), and each command
  gets checkpointing, live status, guardrail verdict, and a redrive
  point from machinery that already exists and is already tested.
- **"Split into steps"** authoring affordance bridges §2.1's
  paste-a-block reality: paste a multi-line script into one node,
  split it into a chained sequence of code-execution nodes (one
  command each). An unsplit blob stays legal — one atomic retry unit,
  by explicit choice.
- **Both retry options are user choices, never forced** — Redrive-
  from-here (DBOS fork; checkpointed steps provably never re-execute)
  vs run-again-from-start already exist at node granularity; splitting
  extends them to command granularity.
- **Locked principle unifying recovery/redrive/rerun: an effectful
  step executes at most once unless a human explicitly chooses
  otherwise.** Recovery parks (never silently re-runs), redrive reuses
  checkpoints, run-again is a deliberate button. "More than once" is
  always intentional.

**Seed decisions (from the same discussion):** the seeded example
ships with a manual trigger + description pointing at the one-click
swap to hotkey (a hotkey can't ship pre-bound; clipboard-watch firing
on every copy would be obnoxious); reviewer edit-before-approve is
named v2, not v1 (approve/deny only); the seeded "Safe sandbox" env is
~~zsh~~ **sh** + clean + Mill-created temp dir + minimal PATH.

**Correction (2026-08-11, found via CI): the seed shipped with `Shell:
zsh`, a real portability bug, not just a CI quirk.** macOS ships
`/bin/zsh` by default (Catalina+), but most headless Linux
distributions -- including GitHub's `ubuntu-latest` runners and any
minimal Linux server install -- do not, so `shellArgv`'s hardcoded
`/bin/zsh` path made the code-execution capability's own built-in
proof unable to run anything at all on Linux server mode, a
first-class deployment target this same doc's §1.3 CI matrix already
builds and tests for. `/bin/sh` is POSIX-guaranteed present on both
platforms and satisfies this seed's own stated intent identically (no
unconditional startup-file read to suppress in `-c` mode either way,
per `shellArgv`'s own doc comment) -- switched the built-in
`ExampleSafeSandboxID` env (`internal/domain/execenv/builtin.go`) from
`ShellZsh` to `ShellSh`. Not a reversal of the zsh/bash/sh typed-choice
design itself (unchanged) -- only the seed's own default.

## What acceptance decides (surfaced, not silently resolved)

1. §1.1's `OPEN` bullet → `LOCKED` as "os/exec + explicit env,
   guardrails are the safety layer" (evidence above).
2. §6 → environments as Configure entities with pinned dir/shell/env.
3. ADR-0023's global-vs-workflow guardrail question → both, via rule
   scopes (env-scope added).
4. Windows execution: explicit non-goal for this capability.

## Implementation postscript (goal 0004, delivered 2026-08-10)

Built: `internal/adapters/procexec` (the supervisor — Setpgid group
spawn, one SIGTERM→grace→SIGKILL kill path, four outcomes, real-process
tests), `internal/domain/execenv` (ExecEnv entity, seeded Safe sandbox,
clean/login profile flags verified against man pages), `codeexec.go`
(the ClassExternal node), `ExecutionService`'s live-Handle registry +
`CancelRun` RPC + Runs-tab Stop button (kills the group AND
CancelWorkflow; distinct `cancelled` status), Configure → Environments
tab + `execenv` picker, `mill://execenvs` MCP resource, and the seeded
"Example: Run copied code" with approve/deny/cancel Go tests.

Deferred (named here, not silently dropped): durable pre-spawn pgid
recording + startup orphan-reaping (amendment #3); crash-mid-step
interrupt-parking — a crash currently re-executes on DBOS replay
(amendment #4, the highest-value remaining item); idle-timeout UI +
last-output-at liveness surfacing (#1/#2); per-workflow concurrency
guard (#6); the "split into steps" authoring affordance; and the
`import_execenv` MCP write tool.
