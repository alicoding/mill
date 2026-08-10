# ADR-0026: Code execution capability — environments, the code-block step, cancellation

## Status
proposed — deliberately NOT accepted: §1.1's command-execution reading
and §6 are `OPEN` in SPEC, and this design resolves both, so it needs
the owner's explicit yes before implementation (goal 0004).

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

## What acceptance decides (surfaced, not silently resolved)

1. §1.1's `OPEN` bullet → `LOCKED` as "os/exec + explicit env,
   guardrails are the safety layer" (evidence above).
2. §6 → environments as Configure entities with pinned dir/shell/env.
3. ADR-0023's global-vs-workflow guardrail question → both, via rule
   scopes (env-scope added).
4. Windows execution: explicit non-goal for this capability.
