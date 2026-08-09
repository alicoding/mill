# ADR-0018: Decision node execution engine and visual rule-builder authoring

## Status
accepted

## Context

§3.3's capability map named Decision/branching as a real, planned
`NodeKind` from the start (ADR-0005's own A2 question), but deferred
authoring it — an edge could carry a condition in principle, but
nothing computed, validated, or let a user write one. Two separate
problems needed solving: how a Decision node's edges get evaluated at
run time (and validated at save time, so a save-time error and a
run-time error never disagree — the same three-layer-agreement
discipline the original linear-chain canvas already established), and
how a human actually authors a condition without hand-editing the
persisted workflow JSON.

## Decision

### 1. Execution engine

A Decision node's outgoing edges are evaluated in order, first match
wins, with exactly one required `"otherwise"` edge as fallback.
`ValidateGraph` compiles every edge's condition against the workflow's
declared `Attributes` schema at *save* time — a bad expression or a
missing `otherwise` is rejected before Save succeeds, not just at Run.
`nextNode`/`ExecuteWorkflow` walk the same conditions at *run* time.
`ExecContext{Payload, Attributes}` replaces the old bare-`string`
payload threaded through `nodeExec` — `Attributes` is the structured
bag Decision conditions evaluate against, seeded from the workflow's
declared schema at each field's zero value, overridable by a real Run
value (§3.4's test-input dialog, ADR-0008). `Payload` is unchanged in
shape; every existing Capture/Process/Apply node reads/writes it
through the new wrapper.

`internal/adapters/expression` wraps `expr-lang/expr` (`Compile`/`Eval`)
behind Mill's own names, per CLAUDE.md's ports/adapters rule — this
confirms §3.3's own capability-map pick (`expr-lang/expr`: MIT,
sandboxed/side-effect-free/loop-bounded by design) rather than adding a
new evaluation engine.

On the canvas: `KindDecision` + a single `decision-route` NodeType (no
`ConfigFields` of its own — a pure routing point, its conditions live
entirely on its edges) render with a real icon/label/color (`GitBranchIcon`).
`isValidConnection` exempts Decision nodes from the single-outgoing-edge
limit every other kind still has — mirrored save-time by the canvas's
own draft-workflow zod check and, authoritatively, by `ValidateGraph`
server-side, since the client can't be trusted.

### 2. Visual rule builder

`react-querybuilder` (MIT, v8.x) is adopted rather than hand-rolling a
visual rule tree — exactly the kind of infrastructure-shaped UI
`.claude/rules/architecture.md`'s adopt-over-hand-roll bias exists for.
Its own runtime dependency on `@reduxjs/toolkit`/`react-redux` is a
real, bounded cost, accepted the same way `elkjs`'s bundle size was
accepted for the canvas itself.

`frontend/src/ruleTranslate.ts`'s `translateToExpr` walks
react-querybuilder's own query-tree shape (`RuleGroupType`) into a real
`expr-lang` boolean expression string — every operator it emits (`==`,
`!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `!`, `in [...]`, `contains`,
`startsWith`, `endsWith`) was checked directly against a real
`expr.Compile`/`expr.Run` call before being relied on, locked by Vitest
cases and independently re-verified against the real Go `expr` package.

`frontend/src/DecisionEdgeInspector.tsx` (opened via `onEdgeClick`, only
for edges whose source is a Decision node) hosts the builder. Fields
offered come from the owning workflow's real, Configure-authored
`Attributes` (`fieldsFromAttributes`, excluding `FieldOptions` —
`AttributeDef` carries no `Options` list to build a choice-set from,
unlike `ConfigField`).

**Deliberately one-way**: there is no reverse parser from an
already-saved expression string back into the visual tree (writing a
real expr-lang parser in TypeScript is its own project). The builder
always starts from an empty query and shows the current saved condition
as read-only text alongside it, plus a raw-text input as the power-user
fallback for editing an existing expression directly.

### 3. Condition storage — a correctness fix caught before shipping

A Decision edge's condition is stored in React Flow's own
`edge.data.condition` (mirrored to `edge.label` for on-canvas
visibility), **not** `edge.sourceHandle` as the original wire-shape
mapping assumed — `sourceHandle` has a distinct, React-Flow-specific
meaning (which physical `<Handle id>` an edge attaches to), and
`CanvasNodeView` only ever renders one unnamed handle per node, so
writing an arbitrary expr-lang string there would have silently broken
edge rendering. Caught before it shipped, not after.

## Consequences

- New: `internal/adapters/expression`, `frontend/src/ruleTranslate.ts`,
  `frontend/src/DecisionEdgeInspector.tsx`, the `decision-route`
  NodeType.
- `ExecContext` replaces the old bare-string payload throughout
  `nodeExec` — every existing node's execution function was touched to
  read/write through the new wrapper.
- A Decision node is real and executable without a rule builder (an
  edge with a hand-authored `expr-lang` string works identically) — the
  builder is an authoring convenience, not a hard dependency of
  execution.
- Not built: a reverse expr-lang parser (round-tripping an
  already-saved condition back into the visual tree) — deliberately
  out of scope, a real future project if ever needed.
