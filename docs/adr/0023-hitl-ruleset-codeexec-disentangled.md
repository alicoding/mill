# ADR-0023: Human review, Ruleset validation, and code execution — three concepts disentangled

## Status
accepted (human review + ruleset built; code execution is design-direction only)

## Context

ADR-0022 shipped the guardrail execution gate, and direct review of it
surfaced that Mill was conflating three genuinely different concepts
under "guardrail" (the user's own decomposition, verbatim in intent):

1. **Human-in-the-loop** — a workflow pauses for *input from someone*,
   case-management style: the item goes to a queue, a reviewer picks it
   up, supplies a decision or data, the run resumes. Composition +
   a queue surface (§3.2's still-open "Review" surface), not policy.
2. **Ruleset validation** — rules evaluated against the *payload/data*
   flowing through a step (business/data validation), the Claude Code
   hooks shape applied to data. Not approval policy, not routing.
3. **Configuration placement** — for each of the above, the §3.5
   two-axis question (step-level vs. Configure-level) applies
   separately; conflating them made policy look like step config.

A fourth concept remains what ADR-0022 built: the ambient
execution-safety gate. Its real design anchor is the still-unbuilt
**code execution** capability (§2.1's copy-a-code-fence → hotkey →
execute flow, §6's environment questions) — the code block itself has a
lifecycle worth first-class treatment, and *that* design owns the
workflow-level vs. global guardrail question.

## Research (constraints checked before adopting)

- **Case management engines (Camunda/Pega class): explicitly out of
  scope by direct decision** — "do not hand roll, do not go to
  Camunda/Pega level." DBOS-Go v1.0.0 already ships queue primitives
  (`NewWorkflowQueue`/`WithQueue`/`ListQueuedWorkflows`, priority/
  dedup — confirmed in the installed source), and Mill's parked-run
  mechanism (ADR-0022's SetEvent/Recv) already IS the queue's data: a
  Review surface is `ListRuns` filtered to unresolved pendings. The
  queue is composed, not built.
- **GoRules ZEN** (the named reference for ruleset modeling): the
  engine core is Rust; its Go binding is CGO over that core. Mill's
  Linux server builds are locked `CGO_ENABLED=0` (§1.3) and §1.1 rules
  out Rust in the dependency pipeline — disqualified on constraints,
  not merit. Its JDM decision-model *shape* (named rules over payload
  data, verdict out) is adopted as the data model.
- **grule-rule-engine** (pure Go): sporadically maintained by its own
  README's admission, its own GRL text DSL (a new syntax to author —
  the exact thing to avoid), and Rete-style fact-mutation semantics
  heavier than payload-in/verdict-out. Rejected.
- **Verdict**: evaluate with `expr-lang` (already adopted, §3.3) and
  author conditions with `react-querybuilder` (already adopted,
  ADR-0018) — the "headless engine" is commodities Mill already
  vetted; only the ruleset data model (named rules + outcomes as JSON)
  is Mill's own, per the core-domain rule.

## Decision

### Human review (built)

- The explicit checkpoint node (`guardrail-wait-approval`, hours old,
  unreleased) is renamed and extended into **`human-review`** ("Human
  review"): pauses the run durably (same DBOS park), and the reviewer
  can now supply **typed input** — values for the workflow's declared
  Attributes — alongside approve/deny. Approved values flow into the
  resumed run's Attributes (same coercion path as the test-input form).
  Declared Attributes are deliberately reused as the input schema — no
  second field-declaration mechanism.
- A **Review** surface (sidebar) lists every parked item across every
  workflow — ambient-gate asks and human-review checkpoints in one
  queue, since they share one pending mechanism. Each item shows what
  wants to run (payload/config/message) with the input form and
  Approve/Deny. This is §3.2's "Review" surface in v1 form: statuses
  and queue visibility, no assignment/SLA/case-notes (the Camunda/Pega
  line, not crossed).

### Ruleset validation (built)

A **`ruleset`** NodeType (KindProcess, effect `none`): config is a
JSON list of named rules `{name, condition}` over
Payload/Attributes — JDM's shape reduced to Mill's actual need.
Execution evaluates every rule; any failing (or errored — fail-safe)
rule fails the step, naming the failed rules; all-pass lets the
payload through unchanged. The Inspector gets a dedicated rules
editor (name + condition rows); conditions reuse the Decision-edge
expression surface. Distinct from Decision (routing) and from
guardrail rules (execution policy) on purpose.

### Code execution (design direction only — nothing built)

The future §2.1/§6 capability: a captured code block becomes a
first-class entity with a lifecycle (captured → parsed → previewed →
gated → executed → result), likely with its own Configure surface
(execution environments: shell, cwd, env — §6's questions). The
ambient gate covers it automatically via an `external` effect class,
and **the workflow-level vs. global guardrail-configuration question
is owned by that design**, not decided here. Next concrete step when
prioritized: capability map first (CLAUDE.md's Plan rule).

**The coherent pipeline model (relayed directly from the user's own
design session), recorded verbatim in intent as the target shape**:
typed Input node (a keyboard event is one event source; fired event
triggers the workflow; the input is typed) → the payload passes a
**ruleset** to ensure guardrail before the next step → the **code
execution** step (configurable globally on the Configure surface AND
at workflow level — the global-vs-workflow model is the named open
design) → **human-in-the-loop as a step** (review anything;
case-management-like queue; adopt, never hand-roll, but not Camunda) →
a **terminal node** whose target source is the DOM when the browser
extension is installed, falling back to clipboard when not (§5's
already-recorded fallback order). Two new specifics this surfaced:
**cancellation semantics** — a running code-execution step can't be
cancelled unless there is a kill-process mechanism, in which case the
step fails and is retryable (maps onto the existing per-step
redrive) — and the framing worth keeping: **Mill is a typed,
event-triggered workflow runtime, not fundamentally a shell-command
launcher**. Everything in that pipeline except the code-execution and
terminal-node steps now exists.

## Consequences

- "Guardrail" now names only the execution-safety hooks (ADR-0022);
  human review and ruleset validation are their own concepts with
  their own surfaces.
- The Review surface supersedes the Runs-tab banner as the primary
  approval UX (the banner remains — same data, workflow-local view).
- ADR-0005's deferred "Ruleset" taxonomy row is now partially real;
  scoring/decision-tables stay future work if a real use names them.
