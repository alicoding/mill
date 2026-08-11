# ADR-0031: Workflow breakpoints — pause at a step, inspect data, resume

## Status
accepted — direct owner mandate 2026-08-11 ("research and adopt the
breakpoints that allow us to pause execution at selected steps to
inspect data at each stage and other missing ones"); the research pass
below is the "research" half, this decision is the "adopt" half.
Implementation queued as goal 0020.

## Context

The owner wants step-level debugging: pause a run at chosen steps,
inspect the data at each stage, resume. A delegated research pass
(2026-08-11, primary product docs + direct reads of Mill's own
guardrail/execution code) surveyed n8n, Temporal, Airflow, Prefect,
Dagster, and Camunda. Convergence:

- **Design-time test affordances** (n8n pin data / edit output /
  partial execution; Dagster Launchpad) are near-universal — and all
  explicitly test-mode-only ("data pinning isn't available for
  production workflow executions", n8n's own docs).
- **Live run-time breakpoints are rare.** Authored pauses exist
  (Prefect `pause_flow_run`/`suspend_flow_run`, n8n's Wait node);
  ambient click-any-node debuggers are effectively extinct — the one
  real precedent, Camunda 7's BPM Workbench, was archived EoL Nov
  2025; Camunda 8 replaced it with failure-triggered incidents
  (park + edit variables + resume). The reason live pause is rare:
  pausing a production-shaped run durably is a durable-execution
  problem, not a debugger-UI problem — Prefect's own pause (blocking,
  timeout) vs suspend (process exits, resumes from checkpoint) split
  names that cost directly.
- **Post-hoc per-step inspection is universal** wherever history is
  already recorded (Airflow XCom tabs, Temporal replay debugging,
  Dagster re-execute-from-failure).

**The pivotal code finding: Mill already ships the rare half.**
`guardrail.Rule{WorkflowID, NodeID, Effect}` is scoped purely by
identity — nothing restricts `EffectAsk` to external-class nodes. An
instance-scoped ask rule on any node already forces `guardrailGate` →
`parkForApproval` → a durable DBOS `Recv` that survives process death
(`executionservice_guardrail.go`). Functionally a durable breakpoint
today, filed under "guardrail policy" and unreachable as a debugging
gesture.

## Decision

Four adopted pieces, each mapping onto an existing primitive:

1. **Breakpoint-as-metadata, reusing the guardrail Rule shape — not a
   new node type.** A `Source` provenance tag on `Rule`
   (`policy` (default) | `debug`) distinguishes a breakpoint from
   policy. The canvas node Inspector gets a one-click "Breakpoint"
   toggle that CRUDs exactly one instance-scoped debug-tagged ask
   rule for that node. **Named exception, not silent erosion**:
   ADR-0022's Update locked rule authoring out of the Inspector
   ("policy is not step config") — a breakpoint is *not* policy, it
   borrows policy's plumbing; the Inspector toggle can only ever
   touch `Source: debug` instance rules, never policy rules, which
   stay Configure-owned. Precedent for the metadata shape over the
   node shape: Mill's own ambient gate is already metadata-scoped,
   and Camunda 8's incident model (the surviving industry shape) is
   metadata-triggered; Prefect's authored-pause shape is already
   covered by Mill's existing `guardrail-wait-approval` node.
2. **Distinct visual identity.** A debug badge (not the guardrail
   shield — recognition, not confirmation: the two must never read as
   one concept) on the canvas node, the Runs tab, and the Review
   queue row; the parked banner says "Paused at breakpoint," with
   Resume/Stop instead of Approve/Deny wording. Same
   `ResolveApproval` RPC underneath.
3. **Per-step data inspection in the Runs tab: input AND output.**
   The DBOS checkpoint already stores the full `ExecContext` (payload
   + attributes); `RunStep` currently surfaces only `.Payload` and
   discards `.Attributes`. Surface both, and show a step's INPUT as
   the immediately-preceding *executed* step's recorded ExecContext.
   **Ordering caveat found by the research (pre-existing, must be
   fixed as part of this, not worked around): `GetRun` walks
   `wf.Nodes` in graph-definition order, not actual executed order —
   wrong for any branching workflow. Use DBOS's own recorded step
   order/timestamps.** Rendering stays the existing plain
   presentation for now; the richer typed-tree view is §3.2's
   already-named shared component, deliberately not built one-off
   here.
4. **Edit-and-resume, narrowly.** `ResolveApproval` already accepts
   `values map[string]string` generically; only human-review parks
   render an input form today (the ambient banner always sends `{}`).
   Render the same typed Attributes form on a breakpoint park, so a
   paused run's *forward* data can be adjusted before resume — n8n's
   edit-output idea, on Mill's durable mechanism. Never rewrites an
   already-committed checkpoint (ADR-0026's at-most-once principle
   holds).

5. **Step mode — run-scoped, not N secret rules (owner addition,
   same session: "I want to be able to step and inspect each node
   payload input and output").** A run can be started as a *stepped
   run* (a debug variant of the normal Run action, run-scoped
   metadata carried in the run input); the gate then parks before
   every node — the same durable DBOS park each time, so a stepped
   run survives process death mid-inspection. Parked controls:
   **Step** (advance one node), **Continue** (finish normally —
   per-node breakpoints still hit), **Stop**. The live-run canvas
   overlay (DONE/ACTIVE/PENDING) is the primary surface: clicking
   any executed/paused node shows that step's input and output for
   the selected run. Build must verify whether the gate is currently
   consulted for pure (`ClassNone`) nodes — if not, step mode forces
   gate evaluation on every node; that widening applies to stepped
   runs only, never normal runs.
6. **MCP debugging (owner addition: "I want your MCP to be able to
   debug too").** Read side: `get_run` grows the same per-step
   input/output/attributes the UI shows — an external agent inspects
   a paused run's data exactly as the human sees it (§1's thesis
   applied to debugging). Write side — the one place this ADR touches
   ADR-0025's permanent `resolve_approval` exclusion, resolved by
   the same policy-vs-debug split this ADR is built on: new MCP
   tools `run_workflow_stepped` / `step_run` / `resume_run` /
   `stop_run` operate **only on `Source: debug` parks** (breakpoints
   and step-mode pauses), rejecting policy asks and human-review
   parks with a clear error. An LLM may drive a debug session it
   started; it may never approve a guarded effect — a stepped run's
   external-effect step still policy-parks for a human, unchanged.
   These tools sit behind the existing MCP write toggle; per-write
   approval is NOT applied to individual step advances (a
   per-keystroke prompt would defeat stepping; the human's consent
   is the write toggle plus the run being theirs to observe live).

## Rejected, with reasons

- **Run-to-node / partial execution as its own feature** — subsumed:
  breakpoint + Stop gives "run until here"; Redrive-from-here already
  gives "resume from a chosen point." A third subgraph-execution
  engine would violate ADR-0008's locked single execution path.
- **Ambient IDE-style stepping with a variable console** — the one
  real precedent (Camunda 7 Workbench) is archived/EoL; nothing else
  ships it; Mill has no code-to-step-through outside `code-execution`
  (which has cancellation, deliberately not stepping, ADR-0026).
- **Mutating an already-completed step's checkpointed output** —
  contrary to DBOS checkpoint immutability and ADR-0026. The
  adjacent, separately-named SPEC §7 gap (editing a run's original
  input before redrive) stays out of scope here.
- **n8n-style pin/mock data editor for un-executed nodes** — parked,
  not rejected forever: "Generate test payload" already covers the
  adjacent need; no concrete pressure names the fuller feature yet
  (anti-speculative-tooling).

## Consequences
- Unlocks: the §3.8 authoring-brief's live-run-state canvas gains a
  natural "paused here" state; the Review queue gains a
  `debug`-source row kind (filter fodder for goal 0002).
- The `Source` tag is additive to stored rules (zero-value =
  `policy`, existing data unaffected).
- Goal 0020 carries the build; acceptance criteria there, not
  restated here.

## Lifecycle
- Owner: Ali (mandate) + orchestrator session (decision, from the
  delegated research pass)
- Update triggers: goal 0020 landing; the shared typed-tree component
  (§3.2) existing (upgrade piece 3's rendering); real pressure naming
  the pin-data editor
- Last reviewed: 2026-08-11
- Review interval: 90 days
