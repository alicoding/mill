# ADR-0037 — Declared step types: the declare-vs-code boundary and the data-backed registry

Status: accepted (goal 0054; research verified against current
primary sources — n8n's documented declarative/programmatic split,
Power Automate's OpenAPI-defined custom connectors with a capped C#
escape hatch, Make's JSON custom apps with embedded IML, Zapier's
Platform UI, and Windmill/Retool as the all-code contrast case).

## Context

Users should be able to CREATE a named palette step by declaration —
"so we don't always have to code it" — and Mill needs a recorded
rule for when code is genuinely required. The field converged
independently on one boundary: declaration covers naming-and-mapping
over an existing execution engine (n8n's REST-routing engine, Power
Automate's OpenAPI+policy engine, Make's Communication block) plus
subflow composition with a typed I/O contract; code is forced by new
protocols, new OS/system access, and — the sharpest recurring line —
arbitrary payload TRANSFORM logic, which every platform handles with
a deliberately scoped, capped escape hatch (Power Automate's 5s/1MB
single-file C#, Make's IML, n8n's "transforms incoming data → go
programmatic"). Mill already ships the engines this maps onto:
`integration-http` (+ Configure HTTPRequest with OpenAPI intake),
`mcp-tool-call`, `child-workflow`, and `code-execution` as the
bounded escape hatch.

## Decision 1 — Mill's declare-vs-code rule (the recorded boundary)

A step type may be DECLARED when it is a naming-and-binding over an
engine that already exists: which HTTP operation, which MCP tool,
which callable workflow — plus palette presentation (label,
description, group) and optionally pinned config values. A step type
REQUIRES code exactly when it needs a new execution engine: a new
protocol family, new OS/system access, or new transform semantics.

The transform line, stated explicitly (the case every platform drew
differently): **declaration may pin an existing engine's config; it
may never introduce new transform semantics.** Payload reshaping is
done by STEPS in the graph (the existing process engines:
extract-html, html-to-markdown, the AI family, code-execution) — not
by an expression/template layer inside a declared type. Mill
deliberately has no IML/expression engine (SPEC §3.3's standing
no-templating decision); `code-execution` inside a pinned ExecEnv is
the one bounded escape hatch, mirroring the field's capped-code
pattern.

## Decision 2 — Declared types are data-backed registry entries that delegate to existing engines

The `NodeType` registry (kernel, ADR-0035) gains ONE new capability,
via this ADR as the required kernel-change record: alongside
compile-time `RegisterNodeType` entries, it accepts DATA-BACKED
entries loaded from a new Configure-tier entity ("Declared step
type": id, label, description, palette group, the engine binding —
`requestId`/`mcpServerId`/`workflowId` via the existing RefKinds —
and optional pinned/hidden config fields). A declared type's exec IS
the underlying engine's exec with the binding pre-applied; declared
types can never reach the gate, the graph engine, or any kernel
surface directly. Effect class is inherited from the underlying
engine (an HTTP-backed declared type is ClassExternal, etc.) — a
declaration can never weaken gating.

## Decision 3 — Identity, versioning, contract

- Declared types live in the configure store (export/import like
  every Configure family, joining the contract as its own schema
  family per ADR-0036 — additive, a new family id).
- The binding is live-referenced by id, the same class as every
  RefKind today; version-pinning semantics are goal 0046's ADR, not
  duplicated here. Deleting a bound entity while a declared type
  references it follows 0046's reference-integrity decision.
- Workflows reference declared types by their step-type id exactly
  like built-ins; the generated contract and `list_step_types`
  expose declared types with a `declared: true` marker — additive
  within the current schema majors.

## Consequences

- The designer UI is assembly, not invention: pick an engine
  binding, name it, optionally pin fields — it appears in the
  palette and the contract.
- The node-standard checklist applies to declared types
  structurally (typed fields, documented, effect inherited, id
  prefixed by kind, seeded example for the designer capability
  itself) — enforced by the designer's own validation rather than
  per-type review.
- Mill combines what no researched platform offers in one place:
  OpenAPI-shaped declared integrations AND typed subflow promotion
  AND self-describing MCP tools, under one guarded palette.
