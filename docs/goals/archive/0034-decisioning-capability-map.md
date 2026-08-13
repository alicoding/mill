# 0034 — Decisioning capability map: decision tables, rule engines, aggregation

## Goal
Owner-raised 2026-08-12: converged capabilities real workflow/decisioning
platforms (n8n, Zapier, and the broader BRMS/rules-engine
space — GoRules' Zen Engine named specifically) all eventually need —
decision tables, rule-engine-style condition evaluation, and
aggregation across steps/runs — that Mill hasn't built and hasn't
mapped against precedent yet. Research-first per CLAUDE.md's Plan step
(a capability map is required before any adopt-vs-build call with more
than one real future use, which this is).

**Already confirmed built, NOT part of this gap** (verified directly
in code before research started): cross-workflow variable access via
Child Workflow's `attr:<name>` input/output binding, including a
correlation-key field for memoizing repeated calls by identifying
input (owner-confirmed this is the "PK thing" referenced). Single-
condition edge-based routing via Decision + `expr-lang/expr` (already
adopted, not hand-rolled). Typed terminal decision outcomes via
ADR-0027's Configure-authored Decision entity (approve/deny/manual-
review/action-needed/uncategorized). Fail-safe multi-rule validation
via `ruleset.go` (all-must-pass, unevaluable-counts-as-failed).

**Genuinely open, confirmed by code search — no aggregation node
exists, no decision-table/matrix construct exists, no rule engine
beyond single expr-lang expressions is adopted.**

## Plan
1. [x] Research DONE 2026-08-12 (real WebSearch/WebFetch, no guessing from training):
   - a commercial risk-decisioning platform's model — rule chains, decision
     tables/matrices, data aggregation within rules (most directly
     relevant precedent given ADR-0027's own typed-outcome shape
     already parallels risk/fraud decisioning platforms).
   - n8n's Switch/decision-table-shaped nodes, its Aggregate node,
     variable/expression access patterns across nodes.
   - Zapier's Paths (multi-branch), Formatter's aggregation-shaped
     transforms.
   - **GoRules Zen Engine — verify Rust dependency status FIRST,
     before anything else about it.** If its core is Rust (as
     suspected, unconfirmed), it's disqualified outright by CLAUDE.md's
     "No Rust anywhere in the toolchain or dependency tree" hard
     constraint — confirm via its own repo/build docs, not assumed.
     If clean, evaluate its JDM (JSON Decision Model) format/decision-
     table shape/expression language for real adoption fit.
   - Any other real, adopted Go-native rule-engine/decision-table
     libraries worth checking (grule-rule-engine, other BRMS-shaped Go
     libraries) as alternates if Zen Engine is disqualified.
2. [x] Capability map DONE: all three verdicts are DEFER — no concrete
   need exists in BACKLOG/SPEC today for decision tables, a rule
   engine, or aggregation. GoRules Zen Engine disqualified outright
   (Rust core + CGO bindings, confirmed at the source). `grule-rule-
   engine`'s decision-table folder is `DRAFT`-status with zero
   implementing code. Reassuring finding: neither n8n nor Zapier adopt
   a library for aggregation either — both hand-built it as plain
   product logic, so nothing is being left on the table by deferring.
3. [x] Recorded in `docs/SPEC.md` §3.3's capability table — three new
   rows (Decision table / Rule engine / Aggregation), each `OPEN` with
   its adopt-vs-build-vs-defer reasoning and composition path onto
   Mill's existing Decision/`ruleset.go`/Child-Workflow primitives.

## Acceptance
A capability map exists citing real precedent (not memory/assumption)
for decision tables, rule engines, and aggregation; the Rust-dependency
question on GoRules Zen Engine is answered definitively; each verdict
states adopt-vs-build-vs-defer with reasoning, composing with Mill's
already-built decisioning primitives rather than re-inventing them.
