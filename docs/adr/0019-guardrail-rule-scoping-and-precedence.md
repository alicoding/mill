# ADR-0019: Guardrail rule scoping and precedence model

## Status
proposed

## Context

§8 of SPEC.md locks the guardrail's default-safe/explicit-skip shape
(a preview/approval popup by default, skipped only when an action
matches an explicit, user-configured skip rule) but leaves open where
skip/approval rules are authored and stored, what they can express, and
how multiple applicable rules resolve against each other. This ADR
records the scoping and precedence design research answered, ahead of
`internal/domain/guardrail` being built.

Prompted directly by the observation that a guardrail rule is probably
the same shape as the Integration/Connector split (§3.5): a technical
contract at Configure time vs. a specific instance's wiring at workflow
time.

## Decision

### Three rule scopes

Applying §3.5's own two-axis Configure test directly to guardrail rules
(rather than assuming an answer) finds real examples at every
cardinality Mill already has:

- **Node-kind-scoped** ("no `list-lookup` node ever needs approval") —
  1:many across every workflow and every Connector, even broader than
  a Connector's own reuse.
- **Connector-scoped** ("any call through Connector X with method
  GET") — 1:many across every workflow using that Connector, same
  cardinality as Connector itself.
- **Workflow/node-instance-scoped** ("this exact step in this exact
  workflow") — 1:1, same cardinality as Trigger config/Attributes.

Node-kind and Connector-level rules belong in Configure (a future
Guardrail-rules tab, same shape as Integration/Lists/Attributes/
Decision, satisfying §8's already-locked dry-run-testable requirement);
workflow-level rules stay inline in the canvas Inspector, matching
Trigger config's existing precedent.

### Precedence: deny/require-approval always wins over allow/skip

Regardless of which layer set it. Modeled on Claude Code's own
categorical deny-first resolution (rules evaluate deny → ask → allow in
that fixed order; specificity never changes it — a broad `Bash(aws *)`
deny blocks even a narrower matching allow), not on Kong API Gateway's
specificity-wins model (most-specific-scope-always-wins — correct for
Kong's tuning-not-safety use case, wrong for Mill's). §8's fail-safe
default is a categorical safety commitment, not a specificity
preference: a narrow, later-authored workflow-level skip-rule must
never be able to silently punch a hole in a broader, more cautious
node-kind- or Connector-level rule.

### Do not adopt OPA/Rego

Or any second policy-evaluation engine. `github.com/open-policy-agent/opa/rego`
was checked directly (Apache-2.0, CNCF-graduated, pure Go, genuinely
importable as a library, not just `opa run` daemon mode) — cleared on
constraints, rejected on fit: Mill already uses `expr-lang/expr` for the
structurally identical job (Decision-edge boolean conditions, §3.3,
ADR-0018), and OPA solves expression evaluation, not the actually-
unsolved part of this problem (where a rule attaches, how layers
resolve) — no policy-language runtime has an opinion on that
regardless. If a skip-condition ever needs a boolean expression, reuse
`internal/adapters/expression`, not a second evaluation engine.

### Precedent checked and found insufficient

n8n's Human-in-the-Loop gating was checked as precedent and found not
to unify these concerns — it has two independent, non-overlapping
mechanisms (workflow/node-instance-scoped approval gating, and a
separate node-kind-level credential-access restriction), not one
layered model. This is a data point for why Mill needs the explicit
multi-layer design above rather than copying one platform's narrower
shape.

## Consequences

Node-kind- and Connector-level rules need a Configure surface
(unbuilt). Workflow-level rules need canvas Inspector UI (unbuilt).
`internal/domain/guardrail` itself is unbuilt.

**Still open, not resolved by this ADR**: how Claude Code's third `ask`
state (distinct from allow/deny) maps onto Mill's own
pass/fail/pending/skipped UI states.

A separate, narrower corner of this space — whether an external MCP
client should be able to *write* Mill's own workflow/Configure
definitions, not just read them — is scoped in its own ADR,
[ADR-0017](0017-mcp-write-tools-guardrail-scope.md), since it governs
*authoring* a workflow via a new external channel rather than *running*
an already-authored one.
