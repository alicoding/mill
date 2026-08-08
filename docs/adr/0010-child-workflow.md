# ADR-0010: Child Workflow node, built on DBOS's native parent/child execution

## Status
accepted

## Context

§3.3's capability map has carried a "Child Workflow" row since ADR-0005
with the verdict "no library has an opinion on Mill's own workflow-of-
workflows semantics" — checked directly this session and found to be
wrong: DBOS (already adopted, ADR-0004) has real, native primitives for
exactly this. Calling `dbos.RunWorkflow` from *inside* an already-
running DBOS workflow function automatically creates a tracked child
(`ParentWorkflowID`, `WithFilterHasParent`/`WithFilterParentWorkflowID`
on `ListWorkflows`); a workflow ID is DBOS's own idempotency key
(`WithWorkflowID` — re-running with the same ID returns the recorded
result instead of re-executing); cancellation and deletion both cascade
to children (`WithCancelChildren`, `WithDeleteChildren`). None of this
is hand-rolled — it's the mechanism this ADR wires Mill up to.

This only became buildable as a first-class, unconditional node type
after [ADR-0008](0008-single-execution-path.md): before that, Mill had
a plain in-memory Run path with no DBOS context at all, and a Child
Workflow node would have needed either a durable-only restriction or a
weaker in-process fallback. With every run now going through
`ExecutionService.RunWorkflow`, a Child Workflow node's `dbos.RunWorkflow`
call always has a real parent DBOS context to nest inside — no
execution-mode branch to design.

Two design questions were worked out with the user directly, in
conversation, before this ADR was written — recorded here as decisions,
not re-litigated:

1. **Not every workflow is a valid child target.** Every Mill workflow
   starts with a Trigger node; a workflow rooted in `trigger-filesystem-
   watch` (or clipboard-watch/schedule/hotkey) can't be invoked as a
   child, because the parent has no way to synthesize "a file changed."
   Only a workflow whose root trigger is a dedicated, non-real-event
   entry point is a valid child target.
2. **The "primary key" for parent-to-child correlation is DBOS's own
   workflow ID**, not a Mill-invented concept — `WithWorkflowID` already
   gives idempotent re-invocation (a parent re-run with the same child
   key returns the child's recorded result instead of duplicating it),
   which is exactly the "workflow-to-workflow dependency" primary-key
   behavior asked about.

## Decision

### 1. `trigger-callable`: a dedicated entry point for child-invocable workflows

New `KindTrigger` NodeType, no config fields (same shape as
`trigger-manual`). Modeled directly on n8n's own "Execute Workflow
Trigger" — a workflow meant to be callable as a sub-workflow uses a
distinct trigger from whatever its "normal" trigger would be, decoupled
from any real external event, declaring only "here's the input shape I
expect" (the workflow's own `Attributes` schema, already built). The
Child Workflow node's picker (below) only lists workflows rooted in
`trigger-callable` — a workflow rooted in a real-event trigger simply
never appears as a valid target, not a validation error surfaced later.

### 2. `child-workflow`: a `KindProcess` node, same family as `integration-http`/`mcp-tool-call`

```go
RegisterNodeType(NodeType{
    ID: "child-workflow", Kind: KindProcess,
    ConfigFields: []ConfigField{
        {Key: "workflowId", Type: FieldText, RefKind: "workflow"},
        {Key: "idempotencyKey", Type: FieldText}, // optional, see §4
    },
}, ...)
```

`RefKind: "workflow"` is a fourth value for the picker mechanism
[ADR-0009](0009-configure-entity-picker.md) already built — `EntityRefField`
gains a `"workflow"` case fetching `CompositionService.Workflows()`
filtered to `trigger-callable`-rooted ones. Unlike
Connector/List/MCP Server, there's no "+ Create new" quick-create for
this case: creating a workflow is Composition's own existing "New
workflow" flow, not a lightweight sub-form — the picker lists what
exists, same as any other reference field, no additive scope beyond
ADR-0009's own mechanism.

Input binding reuses `attributebinding.go`'s existing `parseBindings`/
`resolveBindingValue` (built for ADR-0007 Phase 3, already generic —
not integration-http-specific despite the file's original context):
`Node.Config["inputBindings"]` maps the *child's* declared Attribute
keys to literal-or-`attr:<parentKey>` values resolved against the
*parent's* `ctx.Attributes`. Same `IntegrationBindingsEditor.tsx`-style
UI, parameterized by the child workflow's `Attributes` instead of an
OpenAPI operation's fields — extracted into a shared
`AttributeBindingRows` component both editors use, not duplicated.

### 3. Execution: `ExecContext` carries an opaque per-run `RunContext`

Domain purity (`.claude/rules/backend.md`) means `internal/domain/
composition` cannot import DBOS directly. The existing injected-
function seam (`SetConnectorLookup` et al.) is stateless per call — but
starting a child workflow needs *this run's* DBOS `execution.Context`,
which is run-scoped state, not something a single global function var
can carry safely (two concurrent runs would race on it). Fix:
`ExecContext` gains one new field, `RunContext any` — composition never
inspects it, only threads it through every node's exec call, the same
"carry, don't interpret" contract `StepRunner`'s `stepID` already has.

```go
type ExecContext struct {
    Payload    string
    Attributes map[string]any
    RunContext any // opaque; only a durable caller populates/consumes it
}
```

`ExecuteWorkflow`/`ExecuteWorkflowWithStepRunner` had one ad-hoc
variadic option (`attrValues ...map[string]string`, ADR-0008's
test-input form) — a second, differently-typed optional value doesn't
fit a second variadic (Go allows only one, and it must be last), so
both are folded into a single `ExecuteOptions` struct now that there
are genuinely two independent optional inputs, not one:

```go
type ExecuteOptions struct {
    AttrValues map[string]string
    RunContext any
}
func ExecuteWorkflow(nodes []Node, edges []Edge, attrs []AttributeDef, opts ...ExecuteOptions) (string, error)
func ExecuteWorkflowWithStepRunner(nodes []Node, edges []Edge, attrs []AttributeDef, run StepRunner, opts ...ExecuteOptions) (string, error)
```

Still variadic (0 or 1) so callers passing neither option keep
compiling unchanged; the ~3 call sites that already pass `AttrValues`
wrap it in `ExecuteOptions{AttrValues: ...}`.

`executionservice.go`'s `runWorkflow(ctx execution.Context, in runInput)`
passes `ExecuteOptions{AttrValues: in.Values, RunContext: ctx}` — the
real DBOS context for *this* run, seeded once at the top, threaded
through every node via `ExecContext.RunContext`.

### 4. The injected runner: `SetChildWorkflowRunner`

```go
// composition/childworkflow.go
var runChildWorkflowFn = func(runCtx any, workflowID string, attrValues map[string]string, idempotencyKey string) (string, error) {
    return "", fmt.Errorf("no child-workflow runner registered (yet)")
}
func SetChildWorkflowRunner(fn func(runCtx any, workflowID string, attrValues map[string]string, idempotencyKey string) (string, error)) {
    runChildWorkflowFn = fn
}
```

Wired once from `executionservice.go` (which owns DBOS), same
constructor-time shape as `SetConnectorLookup`. The wired function
type-asserts `runCtx.(execution.Context)`, looks up the target
`composition.Workflow` by ID, and calls
`execution.RunWorkflow(dbosCtx, e.runWorkflow, runInput{...child's own
Nodes/Edges/Attributes..., Values: resolvedInputValues}, execution.WithWorkflowID(childRunID))`
— the *same* registered `e.runWorkflow` DBOS function every run already
uses, called from inside the parent's own execution. This is what gives
`ParentWorkflowID` tracking for free: DBOS sets it automatically because
the call happens inside an already-running workflow context, not
because Mill asks it to.

`childRunID` (the idempotency key): `idempotencyKey` config field,
resolved via the same literal-or-`attr:` mechanism, if set; if empty, a
fresh UUID per invocation (today's behavior for every other run) — an
author opts into idempotent re-invocation explicitly, doesn't get it by
accident from an unset field colliding across runs.

### 5. `RunKind` for a child run

A child run gets `Kind: RunKindTriggered` (docs/adr/0008) — it wasn't
started by a human clicking Run, it was invoked programmatically by its
parent, same classification as a headless trigger fire. It shows up on
the Runs page like any other run, with `ParentWorkflowID` available via
DBOS's own `WorkflowStatus` for a future "show this run's children"
UI (not built this pass — named, not silently dropped).

## Alternatives considered

- **A global childWorkflowRunner closure re-bound per run.** Rejected:
  races under concurrent runs (§3, the actual reason `RunContext` exists
  instead).
- **Widen every `nodeExec` function's signature to take the DBOS
  context directly.** Rejected: touches every existing node type for a
  capability only one of them needs; `ExecContext.RunContext` is the
  minimal, additive seam.
- **Support Child Workflow on a synthetic "in-process" fallback for
  non-durable runs.** Moot — ADR-0008 already removed the non-durable
  path entirely.

## Consequences

- **Locks**: `trigger-callable` NodeType; `child-workflow` NodeType +
  `RefKind: "workflow"`; `ExecContext.RunContext`; the `ExecuteOptions`
  struct replacing the single-purpose `attrValues` variadic;
  `SetChildWorkflowRunner`'s injected-function shape.
- Every existing call site passing `attrValues` as a bare
  `map[string]string]` needs updating to `ExecuteOptions{AttrValues: ...}`
  — a mechanical, one-time migration, not a design risk.
- **Not built this pass, named explicitly**: a "show this run's
  children" UI on the Runs page (the data — `ParentWorkflowID` — is
  already there via DBOS, just not surfaced); cascading
  cancel/delete-with-children exposed anywhere in Mill's own UI (DBOS
  supports it, nothing calls it yet); recursive/cyclic child-workflow
  detection (calling A→B→A) — DBOS itself has no special handling for
  this beyond normal execution, and Mill doesn't add a cycle check
  either; a real workflow hitting this is the trigger to revisit, not
  speculative upfront.
