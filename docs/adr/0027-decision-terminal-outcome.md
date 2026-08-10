# ADR-0027: Decision — a reusable, typed terminal outcome (Configure entity + terminal node kind)

## Status

accepted — 2026-08-10, designed against a detailed owner-supplied review
of the reference no-code decisioning platform's own Decisions surface
(kept vendor-generic per the standing rule, docs/SPEC.md §3.2), with the
three genuinely-owner-scoped calls decided directly in session: the
naming split (routing → "Branch", "Decision" reserved for the terminal
outcome), webhook-as-HTTPRequest-reference (not a second outbound-HTTP
config surface), and Manual Review wiring into the existing Review
queue in v1 (not metadata-only).

## Context

Mill has no terminal-outcome concept. Its existing `decision-route`
node is **routing** (evaluate edge conditions, pick a branch —
ADR-0018); a workflow simply ends wherever its last node has no
outgoing edge, with the final payload as an untyped string. The
reference platform separates these cleanly and the owner adopted that
model directly: **rulesets/branches route; Decisions terminate.** A
Decision there is a Configure-authored, reusable resource: an outcome
*category* (approve / deny / manual-review / action-needed /
uncategorized, immutable after creation), a *typed output schema* (the
workflow's terminal result contract), and optional *response behavior*
(an outbound webhook fired when the Decision is reached). A workflow
node references a configured Decision by identity; the node has
incoming control flow and **no outgoing handle**.

This also converges with the owner's own authoring-surface prototype
(docs/SPEC.md §3.8), whose node taxonomy already names TERMINAL as a
category — two independent references agreeing on the same shape.

## Capability map (CLAUDE.md's Plan rule — every known use, before the schema)

| Capability | v1 | Future (named, not built) |
|---|---|---|
| Decision entity (category + label) | Build — `internal/domain/decision` | Draft/publish/version lifecycle (same OPEN as Integration-level lifecycle, SPEC §4.1) |
| Typed output schema | Build — `AttributeDef`-shaped fields (Key/Label/Type/EnumValues) | Convergence onto the one canonical schema editor (§4.1's shared-schema-editor row); tags/Advanced mode; CSV/JSON import-export |
| Immutable category | Build — server-side rejection on Update + authoring-time warning copy | The shared immutable-choice UX component (reference names Integration connection-mode as the same pattern) |
| Terminal node semantics | Build — new `NodeKind` "terminal", no source handle, `ValidateGraph` rejects outgoing edges | — |
| Output value binding | Build — per-field literal-or-`attr:` bindings on the node (the §3.2-confirmed "node maps workflow data into the referenced resource's contract" pattern) | Required/nullable field semantics |
| Manual-review category | Build — parks the run via the existing approval mechanism into the Review queue; approve terminalizes, deny fails closed | Case schema/subtypes, queues/assignment/SLA (all listed as evidence gaps by the reference review itself) |
| Action-needed category | Metadata-only (no customer concept exists in Mill) | Customer-action wait semantics |
| Webhook on reach | Build — optional reference to an existing HTTPRequest entity; fired after terminalization through the same execution machinery as `integration-http` | Per-decision retry/backoff knobs (v1 rides `go-retryablehttp`'s existing policy); delivery evidence/dead-letter/replay |
| Typed terminal result in run history | Build — the run's final payload becomes `{category, decision, outputs}` JSON | Result-contract surfacing in Activity's runs explorer columns |

## Design

### Entity

`internal/domain/decision.Decision{ID, Label, Category, Outputs,
WebhookRequestID, BuiltIn}` — a new domain package + `ConfigureService`
CRUD + a Configure → Decisions tab, following the List/MCP-Server
pattern verbatim (settings-store JSON blob, slug IDs, top-up seeding
with tombstones). `Category` is one of `approve`/`deny`/
`manual-review`/`action-needed`/`uncategorized` and **immutable**:
`UpdateDecision` rejects a category change server-side; the create form
labels the choice as unchangeable before save (Duplicate is the
migration path, same as the reference). `Outputs` is a list of
`{Key, Label, Type, EnumValues}` fields (the existing minimal
`TypedField` vocabulary — deliberately NOT a fourth schema system; the
canonical-editor convergence stays §4.1's own named future work).
`WebhookRequestID` optionally references an HTTPRequest entity by ID —
**not** URL/auth/retry fields of its own, by direct owner decision: the
governed outbound capability (auth strategies, keychain secrets,
retries, guardrail effect) already exists once, and a second copy is
the exact anti-pattern the reference review itself warns against.

### Terminal node kind

New `NodeKind` `"terminal"` (canvas kind label **DECISION**) with one
`NodeType` `decision-outcome`. The existing routing kind relabels:
`KindDecision`'s UI strings become **BRANCH** ("Branch: route") — code
IDs (`KindDecision`, `decision-route`) stay stable, same code-vs-UI
naming split as ADR-0016. A terminal node renders **no source handle**
(`CanvasNodeView`), `isValidConnection` refuses edges out of it
(draw-time), and `ValidateGraph` rejects any outgoing edge server-side
(save-time) — the standing three-layer agreement. A workflow may have
multiple terminal nodes (one per branch outcome).

Node config: `decisionId` (`RefKind: "decision"` — ADR-0009 live picker
+ inline quick-create) and `outputBindings` (JSON, per declared output
field: literal or `attr:<name>`, resolved **typed** at run time via the
same type-preserving resolution `resolveMCPArguments` established —
a number Attribute bound into a number output stays a JSON number).

### Execution

`composition.SetDecisionLookup` (the established injected seam). On
reach: resolve the Decision; if `Category == "manual-review"`, park the
run through the existing durable approval mechanism (DBOS Recv — the
run appears in the Review queue like any parked step; approve resumes
to terminalization, deny/timeout fails closed, nothing new invented).
Then resolve `outputBindings`, set the run's payload to
`{"category": ..., "decision": <label>, "outputs": {...}}` (JSON), and
end — terminal nodes have no outgoing edge, so the graph walk ends
naturally. If `WebhookRequestID` is set, the referenced HTTPRequest is
executed after terminalization with the outputs JSON as its body,
through the same `httpconnector` path `integration-http` uses.

**Guardrail effect is dynamic for this node type** — a small, real
extension: effect classes are static per NodeType (ADR-0022), but a
Decision with a webhook is `external` while one without is `local`,
and defaulting the whole kind to `external` would make every plain
decision ask for approval (violates §1's not-harder-than-baseline
lock). `decision-outcome` declares `ClassLocal` and the execution
service's gate consults a per-node dynamic-effect hook (resolves the
referenced Decision; webhook present → `ClassExternal`), so a
webhook-bearing Decision asks by default exactly like `integration-http`
does. The hook is additive; every other NodeType keeps its static class.

### Seeds (the standing seed-IS-the-proof rule)

Seeded Decisions: "Approve (example)" + "Deny (example)" (typed
outputs incl. an enum field) and "Manual review (example)". Seeded
workflow "Example: Branch to a decision": manual trigger →
capture-attribute → branch (condition) → the approve/deny Decision
terminals — proving routing-vs-terminal in one picture, typed outcome
in run history, and the review-park path via a second seeded workflow
reaching the manual-review Decision.

## What acceptance decided

1. Mill adopts the routing-vs-terminal split: "Decision" now means the
   terminal outcome; the routing node's UI vocabulary becomes "Branch".
2. §3.5's Decision row (Configure-authored, cardinality unconfirmed) is
   superseded: the *terminal* Decision is Configure-authored **1:many**;
   routing conditions stay on edges (1:1), unchanged.
3. Decision webhooks reuse the HTTPRequest capability by reference —
   Mill will not grow a second outbound-HTTP configuration surface.
4. Manual-review Decisions park into the existing Review queue in v1.
5. Named, deliberately-not-built gaps: action-needed wait semantics,
   case lifecycle/queues/SLA, per-decision retry policy, decision
   versioning, tags/advanced schema mode, schema import/export.
