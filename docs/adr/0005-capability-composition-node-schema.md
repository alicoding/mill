# ADR-0005: Capability composition — node schema & authoring surface (SPEC.md §3)

## Status
proposed

## Context
SPEC.md §3 is `OPEN` on three linked questions: what a node's schema
looks like, how a capability is declared/registered as a node type, and
whether workflows are user-authored on a canvas from day one or config-first
with canvas as a later view. Two pieces are already `LOCKED` and constrain
the answer:

- §3.1: MCP (`modelcontextprotocol/go-sdk`) is the capability-exposure
  layer — Mill wraps local tools as typed MCP tools. Also already
  confirmed there: MCP's own primitives are flat tools/resources/prompts
  with **no chaining semantics** — it does not by itself give Mill a
  workflow model, just a typed-invocation contract per tool.
- §7 (ADR-0004): DBOS-Go + SQLite is the durable-execution substrate.
  Node execution should compose with DBOS's step/workflow model, not
  invent a second one.

The current app has zero data-driven composition to generalize from:
`internal/domain/runbook`'s `List()`/`Run(id)` is a hardcoded Go slice and
switch statement (2 actions) — proven end-to-end per §2.2, but not a
capability model, just the milestone that de-risked the non-composition
pieces (hotkey, clipboard, Primer UI) first.

A concrete reference was reviewed this session: a fintech no-code
decisioning platform (already cited generically in §3.2 for its
Settings/Configure/canvas surface split and type-vs-instance cardinality
— kept vendor-name-free per standing rule) whose actual node taxonomy is:
Ruleset, Decision, Value Assignment, Integration, Code, Child Workflow,
Parallel Steps, ML Model, Database Call — each node configured in a
side panel, wired on a visual canvas, with Form/JSON offered as a
**coequal**, not fallback, authoring/test path alongside the canvas.

## Decision drivers
- Core-domain rule (CLAUDE.md): "the action/capability model and its
  composition rules" is named explicitly as something that must stay
  Mill's own hand-written code, never delegated to a library — MCP can
  supply a tool's own input/output schema, but composition semantics
  (how nodes chain, branch, and reuse) are Mill's to design regardless
  of which library sits underneath.
- §1's thesis: typed, structured state over freehand text is the entire
  point ("what you see is what I see") — any node shape that drops back
  to untyped strings between steps undermines the reason Mill exists.
- Anti-inner-platform / anti-proliferation (§0): this project has already
  been burned by building platform before use case. A canvas (React Flow
  integration, layout, connection-validation UI, minimap/zoom) is a real
  investment with nothing yet to justify it — zero multi-step workflows
  exist today.
- §2.2 precedent: the Runbook milestone deliberately shipped without a
  canvas and still proved the capability end-to-end. Same discipline
  applies here.
- §3.2's already-locked type-vs-instance split: a node's *type* (schema,
  config surface) is defined once and reused across many workflows'
  *steps* — whatever schema shape is picked must preserve that.

## Options considered

### A — Node schema shape
- **A1. MCP-tool-only nodes.** Every node is an MCP tool call; schema
  comes free from the tool's own JSON Schema. Rejected: MCP has no
  chaining semantics (confirmed in §3.1), so branching/parallel/reuse
  would have nowhere to live — doesn't match the reference taxonomy's
  Decision/Parallel/Child-Workflow nodes, and pushes control flow
  somewhere undefined.
- **A2. Two node families: MCP-tool nodes + a small set of Mill-native
  control-flow nodes** (Decision, Value Assignment, Parallel, Child
  Workflow). MCP-tool nodes inherit their schema from the wrapped tool
  for free. Control-flow nodes get a small, hand-written schema Mill
  owns directly — this is exactly the "composition rules" CLAUDE.md
  names as core domain, so hand-writing it isn't extra work invented for
  its own sake, it's the one part no library has an opinion on.
  **Recommended.**
- **A3. Fully generic "everything is a code/expression node."** Fastest
  to build, but throws away typed structure between steps — directly
  contradicts §1's locked thesis. Rejected.

### B — Authoring surface
- **B1. React Flow canvas first**, matching the reference platform's own
  UX and the n8n precedent already named in §3. Rejected for now: no
  canvas library evaluated, no real multi-step workflow to design it
  against, and it repeats the exact "build the platform before the use
  case" failure mode §0 exists to name.
- **B2. Config-first: a data-driven workflow (ordered/DAG'd steps + their
  config) editable via a form/JSON side panel, canvas deferred.**
  Generalizes Runbook's existing shape (already form/list-based, already
  proven) instead of replacing it wholesale. Also matches the reference
  platform directly — its own Inputs tab treats Form/JSON as coequal to
  the canvas, not a lesser fallback, so this isn't a compromise, it's a
  validated real path. **Recommended.**
- **B3. Hybrid — build the canvas immediately as a thin view over the
  same JSON.** Front-loads the same canvas cost as B1 with extra
  indirection; same rejection reasoning as B1.

## Decision
**A2 + B2.** Two node families — MCP-tool nodes (schema inherited from
the wrapped tool) and a small, hand-written set of Mill-native
control-flow nodes (Decision, Value Assignment, Parallel, Child
Workflow) — composed into a workflow that is data (JSON), authored and
tested via a form/JSON side panel generalized from Runbook's current UI.
React Flow (already named in §3 as the eventual canvas engine) is
deferred, not rejected — revisit once 2+ real multi-step workflows exist
to design the canvas against real content instead of speculation.

## Consequences
- Unlocks: `internal/domain/runbook`'s hardcoded switch can evolve into
  a real `internal/domain/composition` (or similarly named) package
  holding node-type registration, workflow data shape, and execution —
  the actual "core domain" CLAUDE.md keeps pointing at.
- A Mill workflow's run is expected to map to one DBOS workflow
  execution (ADR-0004's own, unrelated "workflow" — same word, two
  distinct systems, worth flagging so it isn't misread as the same
  thing); each Mill step's execution to one DBOS step — not decided in
  detail here, left for whoever implements `internal/domain/composition`,
  same as ADR-0004 left `internal/domain/execution`'s exact shape open.
- Not decided here: the exact Go struct shapes for node type/step/
  workflow; how session identity (§7) maps onto a DBOS workflow ID for a
  running Mill workflow; §4's connector model (a connector likely
  becomes one more MCP-tool-node source, but that's §4's call); the
  still-separately-`OPEN` MCP-host-vs-server tension from §3.1
  (irrelevant to this decision — control-flow nodes are Mill's own code
  either way, not an agent loop); versioning/draft-live promotion (a
  real gap this review surfaced, big enough for its own decision once a
  workflow exists to version).
- Risk carried forward: deferring the canvas means Mill's UI stays
  form/list-shaped for longer — acceptable per §2.2's own precedent, but
  worth revisiting if config-only authoring turns out to be genuinely
  harder to use than expected once real multi-step workflows exist, not
  just assumed to be fine indefinitely.

## Lifecycle
- Owner: Ali + whoever implements `internal/domain/composition` next
- Maintains: the two-node-family split; config-first-before-canvas
  ordering; the DBOS-workflow-per-Mill-workflow expectation
- Update triggers: `internal/domain/composition` actually getting
  scaffolded; a second real multi-step workflow existing (the trigger to
  revisit React Flow); §4 (connectors) or §7's session-identity design
  landing in a way that touches this node shape
- Last reviewed: 2026-08-06
- Review interval: 30 days while `proposed`; 365 days once `accepted`
