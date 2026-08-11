# ADR-0022: Guardrail execution gate, effect classes, and durable approval

## Status
accepted

## Context

§8 of SPEC.md locks the guardrail's *shape* (a PreToolUse-style
preview/approval before an action runs; fail-safe default, explicit
skip rules; skip rules must be testable) and ADR-0019 locks the rule
*scoping and precedence* design (three scopes — node-type, Connector/
HTTPRequest, workflow/node-instance; deny/ask always wins over allow;
`expr-lang/expr` for conditions, no OPA). Neither says how the gate
actually executes: where it hooks into the durable execution path, how
a pending approval survives the process dying (§7's sharpened
requirement), which steps get gated at all, and what the approval UI's
states are. This ADR records that, plus the research that grounded it.

## Research (commodity to compose, checked before building)

- **DBOS-Go v1.0.0 ships durable signal primitives** — verified against
  the installed module source (`dbos/workflow.go`), not docs: `Recv`
  blocks *inside* a workflow as a durable, exactly-once, checkpointed
  operation ("becomes part of the workflow's durable state"), `Send` is
  callable from *outside* a workflow, and `SetEvent`/`GetEvent` expose
  key/value state from a running workflow to outside observers. A
  parked approval therefore survives process death and replays without
  re-executing — exactly §7's requirement, with zero new dependencies.
- **n8n's human-in-the-loop** is the established product shape: pause
  the workflow, show which tool + what parameters, human approves or
  denies, workflow resumes or cancels. Validates the pause-preview-
  approve flow as an industry category, not a Mill invention. (ADR-0019
  already recorded that n8n's *rule* model is narrower than Mill's
  three-scope design — this borrows only the pause/resume UX shape.)
- **MCP does not tolerate unbounded blocking tool calls** — the
  2026-07-28 MCP spec added a Tasks extension specifically for
  long-running work, confirming ADR-0017's open sub-question: a
  per-write MCP approval must use a *bounded* synchronous wait, not
  park indefinitely.

## Decision

### Effect classes on NodeType

Every `NodeType` declares an `Effect` class — the purity model §8 and
ADR-0021's deferred shadow evaluation both need:

| Class | Meaning | Default verdict when no rule matches |
|---|---|---|
| `none` | No I/O (pure transform, in-memory lookup) | allow |
| `read` | Reads external state, mutates nothing (clipboard read) | allow |
| `local` | Mutates local, user-visible state (clipboard write) | allow |
| `external` | Calls out of the machine or into another process (`integration-http`, `mcp-tool-call`) | **ask** |

`local` defaulting to allow is deliberate, not an oversight of §8's
fail-safe lock: §1 hard-locks that the guardrailed path must not be
harder than what a person can already do natively, and a clipboard
write *is* the native baseline (§2.1's hotkey-as-the-gesture). A rule
can still tighten any class (deny a local write); the default just
doesn't interrupt the already-proven local loop. External calls are
where §8's fail-safe default bites — friction is the default, speed is
the opt-in rule, exactly as locked.

Child workflows carry no class of their own (`none`): the child's own
steps are gated inside the child's own run — gating the invocation too
would double-charge.

### One rule shape, three scopes (ADR-0019 implemented)

`guardrail.Rule{ID, Label, Effect(allow|ask|deny), NodeTypeID,
RequestID, WorkflowID, NodeID, Condition}` — every non-empty scope
field must match (so `NodeTypeID` alone is a node-type rule,
`WorkflowID`+`NodeID` is an instance rule, `RequestID` matches
`integration-http` steps by their configured request). Precedence is
categorical, ADR-0019's deny-first: any matching deny → deny; else any
matching ask → ask; else any matching allow → allow; else the effect
class's default. `Condition` is an optional `expr-lang/expr` boolean
over `{Payload, Attributes, Config}` via the existing
`internal/adapters/expression` adapter; a condition that fails to
evaluate at gate time fails safe — a deny/ask rule counts as matching,
an allow rule doesn't.

### The gate is an injected seam, evaluated as a checkpointed step

`composition.SetGuardrailGate(func(runCtx any, node Node, ec
ExecContext) error)` — same injected-function pattern as
`SetHTTPRequestLookup`; the domain walk calls it before executing every
non-trigger/non-decision node and aborts on error. The gate
implementation lives in `executionservice.go` (the only place with the
DBOS context):

1. **Evaluate as a checkpointed step** (`guardrail:<nodeID>`): rules
   load live from settings, so the verdict must be recorded — a
   crash-replay re-evaluating against *changed* rules would violate
   determinism. The recorded verdict also gives the Runs UI a truthful
   "auto-allowed by rule X / awaiting approval / denied" per step,
   satisfying §8's pass/fail/pending/skipped states (skipped = an
   explicit allow rule skipped the ask).
2. **allow** → proceed. **deny** → the step errors with the denying
   rule's label; the run fails inspectably (fail = deny).
3. **ask** → `SetEvent("guardrail-pending", …)` then
   `Recv("guardrail-approval", 24h)` — the durable park. An
   `ExecutionService.ResolveApproval(runID, nodeID, approve)` RPC
   `Send`s the decision; deny and timeout both fail the step
   (pending → pass or fail, never silently through).

`RunWorkflow` stays blocking for runs whose graph cannot ask (static
pre-scan, conditions counted as potentially-asking), preserving the
existing UX; a graph that can ask starts non-blocking and returns
immediately with the run ID, so the UI can surface the pending state
(`RunSummary.PendingNode`, read via `GetEvent` with a zero timeout).

### Rule authoring and testing

Node-type- and request-scoped rules: a Guardrails Configure tab
(ADR-0019's placement), with a dry-run tester — pick a workflow's
node, see the verdict and which rule matched, before trusting it
(§8's locked testability requirement). Instance rules: a small
Guardrail section in the canvas Inspector creating the same
`Rule` with `WorkflowID`+`NodeID` pre-filled — one store, one
evaluation path, no parallel mechanism.

### MCP per-write approval (ADR-0017's open half)

**Superseded by [ADR-0032](0032-mcp-write-approval-park-and-poll.md):**
the 120s-bounded-blocking-wait mechanism described in this section as
originally written no longer exists in the code — a live failure (an
away user missed the window) plus research (no surveyed product
fail-closes a human approval on a short window aimed at a possibly-away
approver, and the blocking HTTP response itself plausibly dies against
a real host's own transport timer first) replaced it with park-and-poll:
a durable pending record, a short in-call courtesy window, and an
away-user attention layer (dock badge + actionable OS notifications).
Left as originally written below for the historical record of what
shipped first and why it changed, not as the current shape.

`import_*` MCP tools gain an optional per-write approval mode layered
on the existing default-off toggle: each write parks on an in-process
bounded wait (120s, per the MCP research above — not DBOS, these are
not workflow runs), surfaced to the desktop UI via a Wails event; a
human approves or denies from Mill's own window; timeout denies.
Approval-per-write plus the toggle resolves ADR-0017's recommendation
in full.

## Update — definition sharpened and "nothing hidden" added (same session, decided directly with the user)

Discussion surfaced that the first cut blurred two concepts. Corrections,
all built:

- **What "guardrail" means in Mill, precisely**: hooks around
  *execution* — the Claude Code PreToolUse framing the user named, which
  is also §8's own original lock. The gate fires when an effectful step
  is about to execute; effect classes are the hook registry. When §6's
  command execution lands, it lands as an effect class and is covered by
  the same gate automatically — that future capability, not today's
  HTTP/MCP steps, is the concept's real anchor.
- **Rule authoring is Configure-only.** The step Inspector's
  create-rule buttons were removed (policy leaking into step config);
  the Inspector shows a read-only live verdict instead, and ADR-0019's
  inline-Inspector sentence is amended accordingly.
- **Nothing hidden**: any step whose current verdict is ask or deny
  carries a visible shield badge on the canvas
  (`GuardrailService.WorkflowVerdicts`, refreshed as the graph
  changes) — the gate is ambient but never invisible; you see the
  checkpoint before you ever run.
- **Both industry patterns, not one.** Research confirmed the split is
  real: explicit approval steps (AWS Step Functions'
  `waitForTaskToken` human-approval pattern, Power Automate's "Start
  and wait for an approval", n8n's Wait/HITL node) versus ambient
  execution safeguards (Claude Code hooks/permission rules, GitHub
  Actions environment required-reviewers). Mill now has both: the
  ambient gate above, plus a **"Wait for approval"** NodeType
  (`guardrail-wait-approval`) — a deliberate checkpoint drawn into the
  flow, parking on the same durable mechanism and the same
  pending/approve/deny surface. It always parks: an allow rule relaxes
  the *policy* ask, never a checkpoint the author composed on purpose.

## Consequences

- ADR-0019 moves `proposed` → `accepted`; its open "how does `ask` map
  to UI states" question is answered above.
- ADR-0021's deferred shadow evaluation now has the purity model it
  was blocked on (`Effect` classes); shadow itself stays unbuilt.
- Workflows containing `external` steps change behavior: they park
  pending approval unless an allow rule exists. No real users yet
  (decided directly); seeded examples and e2e cover the new flow.
- The 24h approval timeout is a constant for now — a Settings knob is
  future work if a real need names one.
