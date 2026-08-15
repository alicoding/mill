# 0054 — Step designer + the declare-vs-code boundary

**Raised:** 2026-08-13, owner-directed alongside the step-vocabulary
decision: a designer that lets a user CREATE a new step type by
declaration — and, as importantly, a recorded rule for when a step
genuinely requires code versus when declaring it is enough, "so we
don't always have to code it."

## The industry's converged split (verify current state in-goal;
this is the research the goal opens with)

The workflow field converged on the same boundary independently:
**declaration covers naming-and-mapping over existing engines;
code covers new computation or new OS/system access.**

- Declarative custom steps in the field are overwhelmingly
  API-integration-shaped: describe auth + endpoints + fields
  (several platforms literally accept an OpenAPI document as the
  step-type definition) and the platform's ONE http engine executes
  every such step. No new execution semantics, so no code.
- Composition-as-a-step is the second declarative family: package an
  existing sub-flow as a reusable named step (subflow/sub-workflow
  patterns) — again no new execution semantics.
- Code remains the floor for: new computation, new protocol/OS
  capability, anything the existing engines cannot express.

## Research verified 2026-08-14 (current primary sources; full report in the session record)

The converged split held under verification, with sharper edges:
n8n's own docs draw the declarative/programmatic line at trigger
nodes, non-REST protocols, data transforms, and full versioning;
Power Automate custom connectors are literally built by importing an
OpenAPI 2.0 document, with code capped at one 5s/1MB C# file; Make
declares apps as JSON with IML functions as the embedded escape
hatch; Zapier's Platform UI declares endpoint-by-endpoint with NO
OpenAPI intake (confirmed absent); Windmill/Retool are the all-code
contrast case. Subflow-as-step with a typed I/O contract is
first-class in n8n and (Solution-gated) Power Automate. The one line
every platform drew differently — whether response reshaping is
declaration or code — is resolved for Mill in ADR-0037: transforms
are steps, never step-type declarations. Design decided:
[ADR-0037](../adr/0037-declared-step-types.md) (the boundary rule,
the data-backed registry entries delegating to existing engines with
inherited effect classes, identity/versioning/contract semantics
deferring to 0046 where they overlap).

## Mill's head start (verified in-repo, the designer largely
assembles pieces that exist)

- `integration-http` + Configure's HTTPRequest entities + OpenAPI
  intake already let a user define an HTTP operation without code —
  today it surfaces as config on a generic step, not as a NAMED
  step type in the palette.
- `mcp-tool-call` already imports external capabilities
  declaratively (an MCP server's tools are self-describing).
- `child-workflow` already packages a workflow as a callable unit —
  the subflow pattern, missing only palette promotion.
- `code-execution` is the explicit escape hatch when declaration
  can't express it.

So the designer's v1 is largely PROMOTION: let a user bind a name,
icon, fixed config, and exposed parameters around an existing
engine (an HTTPRequest operation, an MCP tool, a child workflow)
and have it appear in the palette as a first-class step type,
stored as data (a Configure-tier entity), never as generated code.

## The boundary rule to ratify (ADR in-goal)

A step type may be DECLARED when its execution is fully served by an
existing kernel engine (http, MCP, child-workflow, and the other
registered engines) — the declaration only names, parameterizes, and
maps. A step type requires CODE when it needs execution semantics no
engine provides (new protocol, OS surface, computation kind) — that
code lands as a kernel-registered engine per ADR-0035, which then
widens what everyone can declare. The designer must make this
boundary visible in-product: "this needs code" is an explicit,
honest outcome of the designer flow, not a dead end.

Dependencies/sequencing: after 0052 (declared step types must be
first-class citizens of the generated contract/catalog from day one
— a declared type the contract can't describe would fork the
registry) and benefits from 0047's palette metadata facet. Schema
for the declaration entity coordinates with 0046's evolution rules.

## Acceptance (checkable — refined when the goal opens)

- [x] The declare-vs-code ADR is written, with the engine list
      enumerated and the boundary stated as a testable rule.
      ([ADR-0037](../adr/0037-declared-step-types.md), landed ahead of
      slice A.)
- [x] Capability map for the declaration entity (CLAUDE.md Plan
      rule) precedes the schema. (ADR-0037 Decision 2's engine list +
      this file's own "Mill's head start" section serve as the
      capability map: every future declaration surface — HTTP,
      MCP, child-workflow — named with its current status before the
      schema below was designed.)
- [~] Designer v1: a user can promote at least an HTTPRequest
      operation and a child workflow into named palette step types
      without writing code; declared types appear in the generated
      contract/catalog identically to built-ins. **Slice A (backend)
      done; the "a user can" UI half is slice B.** The data-backed
      registry supports all three ADR-0037 engines (HTTP, MCP,
      child-workflow) uniformly — `internal/domain/declaredsteptype`,
      `composition.SetDeclaredNodeTypeLookup`/`resolveDeclaredEntry` —
      and declared types appear in `list_step_types`/the generated
      contract catalog with `NodeType.Declared: true`, additive,
      verified by `TestRootContractDocument_MatchCommitted`. No
      designer UI exists yet to let a user actually author one by
      hand; slice B builds that form.
- [x] A declared step type round-trips export/import like any
      entity (0052 symmetry rule). (`ExportDeclaredStepType`/
      `ImportDeclaredStepType`, the `steptype` contract family at
      `mill://schema/steptype/v1`, `TestExportImportDeclaredStepType_RoundTrips`.)
- [ ] "Needs code" is a designed, explicit designer outcome with
      honest copy, not a failure state. **Slice B** — no designer UI
      exists yet in slice A to have an outcome at all.
- [x] Seeded example: at least one declared step type ships as a
      seed exercising the full path (seeds ARE the proof). "Check
      httpbin" (`declaredsteptype.ExampleCheckHTTPBinID`, over the
      seeded no-auth HTTPRequest example) + "Example: Declared step
      type" (the workflow using it), proven end-to-end — real
      guardrail park/approve, real HTTP round trip through the
      synthesized exec — by
      `executionsvc.TestSeededDeclaredStepTypeExample_ApproveFiresRealHTTPCallThroughTheDeclaredType`.

## Slice A status (backend, this change)

Shipped: the domain entity + CRUD/export/import/dataevent
(`internal/domain/declaredsteptype`, `internal/services/configuresvc`
`configuredeclaredsteptype*.go`), the `composition` package's
data-backed `NodeType` resolution (`lookupNodeTypeEntry`, replacing
every direct `nodeTypeRegistry` read in `execute.go`/`nodetypes.go`),
the `steptype` contract family, the `NodeType.Declared` catalog
marker, and the seeded proof described above. A real construction-
order hazard was found and fixed in the same change: `main.go`
constructs `CompositionService` (which seeds
`composition.BuiltInWorkflows()`) before `ConfigureService` exists to
wire the declared-type provider, so the seeded declared-type workflow
is invisible on that first pass; `ConfigureService`'s constructor now
calls the newly-exported `CompositionService.ReconcileBuiltIns()` a
second time, after wiring the provider, to pick it up.

Deliberately left to slice B: the designer UI itself (a form to
create/edit a declared type by picking an engine binding — no forms
were built this slice, per this goal's own scope split), the "needs
code" designer outcome/copy, and reset/restore-to-seed affordances for
declared step types (every sibling Configure entity has
`Reset*ToSeed`/`Restore*` RPCs; declared step types don't yet — not
required by this goal's acceptance criteria, added if/when slice B's
UI needs them). Reference-integrity on a deleted declared type a
workflow still points at follows today's existing dangling-`RefKind`
behavior, same as every other Configure entity — real reference-
integrity handling is goal 0046's own scope, not duplicated here.
