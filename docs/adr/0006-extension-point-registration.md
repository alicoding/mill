# ADR-0006: Self-registration for Mill's own extension points (SPEC.md §3.6)

## Status
proposed

## Context
SPEC.md §3.6 already named the problem directly: "as more primitive
capabilities land, Mill risks staying a codebase every new Trigger/
Process/Integration has to be hand-added to, rather than a platform
something can extend without touching core Go files." It already split
this into two sub-problems and closed one of them (Mill as MCP client —
a whole class of Integration-shaped capability needs zero Go code
change today, `LOCKED`, built). The other sub-problem — Mill's own
hand-written extension points still requiring a shared-file edit per
addition — was named but never quantified past one example
(`nodetypes.go`/`execute.go`).

Prompted directly to line this up properly: researched the actual
converged pattern (not assumed) and re-audited the whole codebase for
every place this shape recurs, not just the one already-known instance.

**The full capability map, verified against the real code, not
assumed** — every place adding a new *instance* of an existing
extensible concept currently requires editing a shared file:

| Extension point | Central-file cost today | Previously documented? |
|---|---|---|
| Composition `NodeType` | `nodetypes.go`'s `NodeTypes()` + `execute.go`'s `nodeExec` map (2 files) | Yes — §3.6, `OPEN` |
| Trigger type | Same 2, **plus `triggerservice.go`'s `TriggerService.start()` switch** (3rd file) | **No** |
| Connector `AuthType` | `connector.go`'s `Validate` switch + `composition/integration.go`'s `authHeader` switch (2 files) | **No**, minor |
| Configure entity *kind* (a whole new kind, not a new instance of an existing one) | `ConfigureService` struct field + constructor wiring (~3-4 bounded lines) | **No**, small |
| Capabilities index entry | `capabilities.go`'s `List()` (1 line) | Cheap already, not real pain |
| MCP-tool-shaped capability | Zero Go changes | Yes — `LOCKED`, built |

Two of these (Trigger type, Connector AuthType) are the *exact same
shape* as the already-flagged NodeType problem — a switch/map a new
addition must find and edit correctly, with no compiler help if a case
is missed (a forgotten `execute.go` entry for a node type declared in
`nodetypes.go` fails at runtime, `"unknown node type: ..."`, not at
build time). The Configure-entity-kind and capabilities-index cases are
real but small and infrequently touched — Connector/List/MCPServer, the
only three Configure entity kinds that exist, landed months apart, not
as a hot path.

## Research
**Hexagonal architecture / ports & adapters (Cockburn).** Confirmed
directly against Cockburn's own description, not just the term: the
core owns its ports (interfaces for what drives it and what it drives);
adapters implement those ports; the boundary is compiler-enforced, not
just a convention. Mill already *is* this shape — CLAUDE.md's
`internal/domain/*` (pure) vs. `internal/adapters/*` (commodity, behind
small interfaces) split, locked since the repo-layout ADR — it has just
never been named that explicitly anywhere in Mill's own docs. This ADR
is partly that: writing down a name for a pattern already in force, so
"is this hexagonal architecture" isn't a re-derivation next session.
What hexagonal architecture does *not* by itself solve is this ADR's
actual subject — swapping *which adapter* implements a port is already
solved (ports/adapters); *registering a new one without editing a
shared list* is a different, narrower problem.

**The registration mechanism: Go's `database/sql` driver pattern,
confirmed as the real, converged idiom, not invented.** A driver
package calls `sql.Register(name, driver)` from its own `init()`;
the consumer takes a blank `import _ "driver/package"`. `image`'s
`RegisterFormat` and most Go plugin-shaped systems (Kubernetes
`controller-runtime`'s scheme registration, `net/http`'s `Handle`)
converge on the same shape: a package-level registry map, populated by
each implementation's own `init()`, so *adding* an implementation means
*adding a file*, not *editing a map literal*. The one thing this
doesn't remove: somewhere still has to import every implementation
package (even as a blank `_` import) so its `init()` runs — Go has no
runtime plugin discovery without cgo-based `.so` plugins, which is
correctly out of scope here (single-binary, no-cgo-complexity
constraints already lock against that shape). The honest framing: this
converts "edit shared *logic*" (a map/switch case that must be written
correctly) into "add one *import line*" (mechanical, can't typo the
map key wrong, a missing import is a compile-time "declared and not
used" or an obviously-absent capability, not a silent runtime string
mismatch) — isolated, not eliminated, exactly as §3.6 already said for
the one case it covered.

## Decision drivers
- Real, demonstrated pain only where it's actually been hit: NodeType's
  two-file cost was named directly after three additions in one session
  each needed both edits (§3.6). The newly-found Trigger-type cost is
  the same shape, same session, same actual friction — just not
  reported before because no one added a *new trigger type* recently
  enough to notice.
- Anti-proliferation (this repo's own standing instinct, confirmed
  again this session): don't build an abstraction for a cost that's
  already small and rarely paid. Connector `AuthType` and
  Configure-entity-kind additions are 2-4 line, infrequent edits — the
  same "no UI for a decision that doesn't exist yet" discipline §3.5's
  Configure recheck already applied to node kinds applies here to
  registries.
- CLAUDE.md's core-domain rule: the registration *mechanism* is
  commodity (a well-known Go idiom, safe to adopt outright); *what gets
  registered* (a NodeType's config schema, a Trigger's dispatch
  behavior) stays Mill's own hand-written logic either way — this ADR
  only changes how a new one gets *found*, not what it *does*.

## Options considered
- **A1. Registry/self-registration for NodeType + Trigger type only**
  (the two proven-painful, same-shape cases). Each node-type file
  (already mostly one-per-file today, e.g. `integration.go`,
  `listlookup.go`, `mcpcall.go`) gains its own `init()` registering its
  `NodeType` + exec function into a shared registry; `TriggerService`'s
  dispatch does the same for trigger kinds. `nodetypes.go`/`execute.go`
  collapse from "the map every addition edits" into "the registry
  every addition's own `init()` populates" — still one file with a
  blank-import list, but that list is mechanical, not logic.
  **Recommended.**
- **A2. Registry for every extension point in the capability map**,
  including Connector `AuthType` and Configure entity kinds. Rejected:
  solves problems that aren't real pain yet, adds indirection to code
  that's currently simple to read (`switch c.AuthType` is more legible
  than a registry lookup for 3 known cases), and this repo has already
  been burned once by exactly this shape of premature generalization
  (§0).
- **A3. Leave everything as-is, just document the newly-found costs.**
  Rejected: the NodeType cost was already real enough to name directly
  in §3.6 as "worth taking seriously... before the node-type list grows
  much further" — the Trigger-type cost is identical in shape and
  already has 5 cases today (manual/hotkey/schedule/clipboard-watch/
  filesystem-watch), the same scale that prompted the NodeType finding.
  Documenting without fixing the one already flagged as worth fixing
  isn't consistent.

## Decision
**A1.** Self-registration (the `database/sql` shape) for Composition
`NodeType`+exec pairs and Trigger-type dispatch — the two extension
points with demonstrated, repeated editing pain. Connector `AuthType`
and Configure-entity-kind additions stay plain switches/struct fields,
documented here as an accepted, bounded cost, not silently ignored.

## Consequences
- Unlocks: adding a new NodeType or Trigger type becomes "add one file
  with an `init()`," matching the file-per-concern shape
  `integration.go`/`listlookup.go`/`mcpcall.go` already mostly follow —
  this is largely a formalization of an existing informal convention,
  not a new one.
- Not decided here, left to implementation: the exact registry
  interface shape (a `Register(NodeType, ExecFunc)` function vs. a
  `Registerer` interface implemented per node-type struct); whether
  Trigger-type registration reuses the same registry or gets its own
  (they're structurally similar but not identical — a Trigger's
  registration includes dispatch/listener wiring a plain Process node
  doesn't have); whether existing node types migrate in one pass or
  incrementally as each is next touched.
- Risk: a registry adds one layer of indirection between "grep for a
  node type ID" and "find its implementation" — mitigated by keeping
  the file-per-node-type convention (already mostly true) so `grep -r
  "trigger-hotkey"` still lands on one file, just with an `init()`
  instead of two map/slice entries.
- This ADR's `Status` stays `proposed` — this is the plan, not yet
  implemented. Implementation is a real refactor of `nodetypes.go`,
  `execute.go`, and `triggerservice.go` (files with existing test
  coverage that must keep passing unchanged), sized enough to warrant
  its own confirmed pass rather than folding into this research/plan
  turn.

## Lifecycle
- Owner: Ali + whoever implements the registry next
- Maintains: the extension-point capability map above; the A1 scope
  boundary (NodeType + Trigger only, not the smaller Configure/AuthType
  cases)
- Update triggers: a new Configure entity kind or Connector `AuthType`
  actually becoming frequent enough to revisit A2's rejection; the
  registry implementation landing (this ADR moves toward `accepted`);
  a Decision/Parallel/Child-Workflow node kind landing (ADR-0005) before
  the registry does, which should use the new mechanism from the start
  rather than adding a fourth case to the old map/switch shape
- Last reviewed: 2026-08-07
- Review interval: 30 days while `proposed`; 365 days once `accepted`
