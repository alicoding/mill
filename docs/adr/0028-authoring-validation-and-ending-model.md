# ADR-0028: Authoring validation — issue list, severities, and the workflow-ending model

## Status

accepted — 2026-08-10, every substantive call made directly by the
owner in live discussion (goal 0008's held decisions): the severity
contract, the trigger-root rule, and the ending model. Implementation
is goal 0008's build.

## Context

The owner demonstrated the gap live: a workflow whose only node was a
Capture saved without complaint — `findRoot` requires exactly one
root but never checks its Kind, and Mill surfaces validation only as
a single save-rejection string, where both reference platforms show
an authoring-issues surface listing every problem at once. Ownership
was clarified in the same discussion: **`composition.ValidateGraph`
owns all graph rules** (the client mirrors at draw/save time); DBOS
owns none of it.

## Decisions

### Severity contract
**Errors block save; warnings never do** (owner's stated platform
experience: "error is not allowing people to save"). One contract
everywhere — canvas save, `UpdateWorkflow`, and MCP
`update_workflow`/`validate_workflow` agree. Publish uses the same
gate as save (errors only); whether publish should someday also
refuse warnings is recorded as open, not decided.

### The ending model (the gating call for ADR-0026's terminal)
**Ending-rule + warning — kinds stay exactly as built:**
- Apply nodes remain freely chainable mid-flow
  (`capture → transform → apply(clipboard) → integration-http` stays
  legal — sequential side effects are real automation, n8n-grade
  composability preserved; "unify Apply into terminal" was considered
  and rejected as removing real capability for taxonomy neatness).
- `KindTerminal` (decision-outcome) remains the only structurally
  terminal kind (no source handle, no outgoing edges).
- A **Process or Capture leaf is a WARNING** — "computed something,
  delivered it nowhere" — legal to save, flagged visibly.
- §3.8's prototype TERMINAL category maps onto {apply-*,
  decision-outcome} as *ending-capable kinds* for display/taxonomy
  purposes only; no graph-rule change follows from the label.

### Initial rule list
| Rule | Severity |
|---|---|
| Root node is not a Trigger kind | **Error** (n8n's own hard requirement; §3.4's "one concept" lock) |
| Existing structural rules (single root, out-degree, Decision-edge compile, terminal no-outgoing, secret guardrail) | **Error** (unchanged) |
| Process/Capture leaf | Warning |
| Required entity ref unset (`requestId`/`listId`/`mcpServerId`/`workflowId`/`decisionId` empty) | Warning — "will fail at run time"; blocking would forbid saving work-in-progress drafts |
| Decision node with no outgoing `otherwise` edge | Error (existing, joins the list) |

### Mechanism
`ValidateGraph` returns the **full issue list**
(`[]Issue{Severity, NodeID?, EdgeID?, Message}`) instead of
first-error-only; save rejects when any Error is present. Surfaces:
an editor toolbar badge (nE/nW) + expandable issues panel where each
issue selects its offending node/edge; per-node canvas badges for
warnings (the guardrail badge's nothing-hidden pattern); MCP
`validate_workflow` returns the whole list — ADR-0025's
iterate-against-errors loop improves for free.

## Consequences

The owner's exact repro (single-Capture workflow) becomes unsaveable
with a clear multi-issue explanation; drafts stay saveable through
incompleteness warnings; ADR-0026's code-execution pipeline ends in
its clipboard/DOM delivery Apply step legally, with no ceremony
Decision required — and a Decision ending stays available whenever
the outcome is the product. Existing persisted workflows with
non-trigger roots (if any) load fine but cannot re-save until fixed.
