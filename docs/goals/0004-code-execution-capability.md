# 0004 — Code execution capability

## Goal
`docs/SPEC.md` §2.1/§6's core loop: a captured code block executes
locally through Mill's own guardrailed process — the pipeline model
recorded in ADR-0023 (typed event input → ruleset → code execution →
human review → terminal), with the code block as a first-class entity.

## Plan
Research is COMPLETE (2026-08-10, Sonnet research pass, findings in
the session record + to be folded into the design ADR): process-group
tree-kill is a ~50-line stdlib hand-roll (no maintained library
exists); DBOS CancelWorkflow does NOT interrupt an executing step
(confirmed from source) — Mill needs its own in-process CancelFunc
registry with the kill wired into the step function; no sandbox
library fits macOS+Linux+no-daemon — os/exec with explicit
Dir/Env/shell is the mechanism, the guardrail engine is the safety
layer (confirms §1.1's OPEN lean with evidence).

1. [x] Capability map + design: [ADR-0026](../adr/0026-code-execution-capability.md)
   (`proposed`, 2026-08-10) — ExecEnv Configure entity, the
   `code-execution` node (effect external → auto-guarded),
   global-vs-workflow guardrail via rule scopes (env scope added),
   the CancelFunc registry + process-group kill design.
2. [x] Drafted; **awaiting the owner's yes** — acceptance resolves
   §1.1's OPEN command-execution reading, §6, and ADR-0023's
   global-vs-workflow question (all listed in the ADR's own
   "What acceptance decides"). Do NOT implement before that yes.
3. Implement: adapter (os/exec + process-group kill + timeout +
   incremental output), node type (ClassExternal — automatically
   guarded), Configure surface, seeds + tests.

## Acceptance
The seeded example: copy a code fence, hotkey, watch it park for
approval, approve in Review, see the output — the §2.1 loop minus the
browser bridge, live on the owner's machine.
