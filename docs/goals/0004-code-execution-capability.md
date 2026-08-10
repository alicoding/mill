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

1. Capability map first (CLAUDE.md's Plan rule): execution
   environments as a Configure entity (shell/cwd/env), the code-block
   node type, kill/cancel/timeout semantics, global-vs-workflow
   guardrail config placement (§8's deferred question lives HERE).
2. Design ADR; surface the §1.1 OPEN confirmation to the owner.
3. Implement: adapter (os/exec + process-group kill + timeout +
   incremental output), node type (ClassExternal — automatically
   guarded), Configure surface, seeds + tests.

## Acceptance
The seeded example: copy a code fence, hotkey, watch it park for
approval, approve in Review, see the output — the §2.1 loop minus the
browser bridge, live on the owner's machine.
