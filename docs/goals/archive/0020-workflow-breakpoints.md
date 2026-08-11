# Goal 0020 — Workflow breakpoints (pause · inspect · resume)

**Design decided:** [ADR-0031](../adr/0031-workflow-breakpoints.md)
(`accepted`, owner mandate 2026-08-11). This file is delivery scope
only — the reasoning and the rejected alternatives live in the ADR.

## Goal

A user can toggle a breakpoint on any node from the canvas Inspector;
a run reaching that node parks durably (the existing guardrail
ask-park, tagged `Source: debug`), shows a "Paused at breakpoint"
banner with the run's data, lets them adjust forward-flowing
Attribute values, and resumes or stops. The Runs tab shows every
step's input AND output (attributes included), in actually-executed
order.

## Plan

1. `guardrail.Rule.Source` (`policy` zero-default | `debug`) +
   Inspector "Breakpoint" toggle CRUDing exactly one instance-scoped
   debug ask rule per node (never touching policy rules — the named
   ADR-0022 exception).
2. Distinct debug badge (canvas node, Runs tab, Review queue row) —
   never the guardrail shield; banner wording Resume/Stop.
3. Runs tab: surface checkpointed `Attributes` alongside `Payload`;
   fix `GetRun`'s graph-definition-order walk to DBOS's recorded
   execution order (pre-existing branching-workflow bug, in-scope).
4. Breakpoint parks render the typed Attributes form (the
   human-review form, reused) feeding `ResolveApproval`'s existing
   `values` param.
5. Step mode (ADR-0031 §5): run-scoped stepped-run start (Run menu
   variant), park-before-every-node, Step/Continue/Stop controls in
   the CurrentStepBar; click an executed/paused node on the live-run
   canvas → that step's input/output. Verify-and-handle the
   pure-node gate question the ADR flags.
6. MCP debugging (ADR-0031 §6): `get_run` grows per-step
   input/output/attributes; new `run_workflow_stepped`/`step_run`/
   `resume_run`/`stop_run` tools scoped to `Source: debug` parks
   only (hard-reject policy/human-review parks), behind the write
   toggle, no per-step approval prompts. Proven by a real-MCP-client
   Go test driving a full stepped session.
7. Seed + proof: extend or add a seeded example workflow with a
   breakpoint demonstration (likely: a debug rule on the seeded
   branch-to-decision example), Go test against real DBOS proving
   park → value-edit → resume changes the downstream branch taken,
   plus e2e for the toggle + banner + step mode. SPEC §8 entry in
   the same change.

## Acceptance

- Toggling the breakpoint on/off from the Inspector round-trips and
  is visible as the debug badge before any run.
- A test run parks at the node; the banner names it a breakpoint;
  Resume continues, Stop cancels; deny-timeout semantics unchanged.
- Editing an Attribute value at the pause changes what flows
  downstream (proven by the DBOS-backed test via the branch taken).
- Runs tab shows step input/output including attributes, in executed
  order, for a branching workflow.
- Full check suite + the seed-proof registry green.
