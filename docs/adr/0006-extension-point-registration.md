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

## Update — full implementation plan

Prompted directly ("let's plan fully"): resolved every "not decided
here" item above against the actual current code (read in full, not
assumed), not just described at the pattern level.

**The registry interface, concretely.** `internal/domain/composition`
gets a new `registry.go`:

```go
type ExecFunc func(node Node, ctx ExecContext) (ExecContext, error)

type nodeTypeEntry struct {
    nodeType NodeType
    exec     ExecFunc // nil for Trigger/Decision -- see ExecuteWorkflow's existing Kind check
}

var nodeTypeRegistry = map[string]nodeTypeEntry{}

// RegisterNodeType panics on a duplicate ID -- a collision is a
// programming error caught at process startup (package init time), the
// same fail-fast behavior sql.Register itself uses, not a runtime data
// problem to recover from softly.
func RegisterNodeType(nt NodeType, exec ExecFunc) {
    if _, exists := nodeTypeRegistry[nt.ID]; exists {
        panic("composition: node type " + nt.ID + " registered twice")
    }
    nodeTypeRegistry[nt.ID] = nodeTypeEntry{nodeType: nt, exec: exec}
}
```

A plain `Register(NodeType, ExecFunc)` function, not a `Registerer`
interface implemented per node-type struct — there's no need for a
struct/method indirection when a function value already captures
everything an exec step needs (matches `sql.Register`'s own shape, a
function call, not an interface implementation, for the same reason).

**Ordering, resolved.** `NodeTypes()`'s current output order is a
deliberate literal sequence (Triggers, then Capture/Process/Apply/
Decision, then the three Configure-backed Process nodes); Go map
iteration is non-deterministic, so reading straight from
`nodeTypeRegistry` would silently randomize it. Checked whether
anything actually depends on that order first, not assumed either way:
`nodetypes_test.go` and the frontend's e2e count assertion
(`composition.spec.ts`) are both order-independent (confirmed by
reading them). Still worth a *deterministic* order rather than
"whatever `range` gives today, happens to work, breaks silently on a
future Go version" — `NodeTypes()` sorts its output by
`(kindOrder[Kind], ID)` at call time, `kindOrder` a small fixed map
mirroring the current literal sequence. Chosen over relying on Go's
real-but-subtle `init()` file-order guarantee (lexical filename order,
gc-specific, not something worth depending on silently) — an explicit
sort is simpler to verify than an implicit ordering guarantee.

**Trigger registration — two registries, deliberately, not one,
because of a real constraint found by reading `triggerservice.go` in
full.** `TriggerService.start()`'s cases aren't pure functions like
`nodeExec`'s: `trigger-hotkey`'s case reads `s.hkRaw` and closes over
`s.fire`, i.e. every case needs `*TriggerService` itself, not just a
`Node`/`ExecContext` pair. A trigger starter's signature has to be
`func(s *TriggerService, workflowID string, config map[string]string)
(*activeListener, error)` — genuinely different from `ExecFunc`, and it
lives in `package main` (`triggerservice.go`'s own package), not
`internal/domain/composition`, since `TriggerService` is Wails-binding
state, not domain logic (CLAUDE.md's domain-package-purity rule already
forbids `composition` from knowing about `TriggerService`). So: a
second, small registry in `package main`:

```go
type triggerStarter func(s *TriggerService, workflowID string, config map[string]string) (*activeListener, error)
var triggerRegistry = map[string]triggerStarter{}
func RegisterTrigger(nodeTypeID string, start triggerStarter) { ... } // same panic-on-duplicate shape
```

`TriggerService.start()` becomes a two-line registry lookup. **The two
registries stay colocated per trigger type despite living in different
packages**: each trigger type's file lives in `package main` (where
`TriggerService` already is) and its one `init()` calls *both*
`composition.RegisterNodeType(...)` (the schema half) *and*
`RegisterTrigger(...)` (the dispatch half) — one file, one trigger
type, both halves of its definition, even though today those two halves
are split across `nodetypes.go` and `triggerservice.go` with no single
file owning a trigger type's full definition. Confirmed this ordering
is safe, not assumed: Go initializes an imported package's `init()`s
before the importing package's own (`main` imports `composition`, so
`composition`'s package-level state is ready before any `main`-package
`init()` runs `RegisterNodeType`), and nothing in `composition` calls
`NodeTypes()` at its own init/var-init time — it's only ever called
from request-handling code, well after every package's `init()` has
run. `internal/domain/composition` still never imports `main` in
either direction; the dependency arrow is unchanged, only which file
calls `RegisterNodeType` moves.

**File plan** (names indicative, may shift slightly during
implementation — not the part worth re-confirming):

*`internal/domain/composition/` (registers via `RegisterNodeType`
directly, no cross-package split needed):*
- `registry.go` — the registry itself (new)
- `capture.go` — `capture-clipboard-html`'s `NodeType` + exec (new;
  `readClipboardHTML` moves here from `execute.go`)
- `processmarkdown.go` — `process-html-to-markdown` (new;
  `htmlToMarkdown` moves here)
- `applytext.go` / `applyhtml.go` — the two Apply node types (new;
  `writeClipboardText`/`writeClipboardHTML` move here)
- `decision.go` — `decision-route`'s `NodeType` only, `exec: nil` (new)
- `integration.go`, `listlookup.go`, `mcpcall.go` — **existing files,
  gain an `init()` each** registering the `NodeType`+exec they already
  support; no new files needed, these three are already the
  best-prepared case (support logic already isolated, just the
  registration call is still centralized)
- `nodetypes.go` — shrinks to `sampleHTML`, `NodeTypes()` (now reads +
  sorts the registry), `nodeType()` (registry lookup), `newNodeID`,
  `BuiltInWorkflows()` (unchanged — only references node type ID
  strings)
- `execute.go` — shrinks to `ExecuteWorkflow` only, with
  `nodeExec[node.NodeTypeID]` replaced by
  `nodeTypeRegistry[node.NodeTypeID].exec`

*`package main` (registers both halves per trigger type):*
- `triggerregistry.go` — the second registry (new)
- `triggermanual.go`, `triggerhotkey.go`, `triggerschedule.go`,
  `triggerclipboardwatch.go`, `triggerfilesystemwatch.go` — one file
  per trigger type, each calling `composition.RegisterNodeType` +
  `RegisterTrigger` from its own `init()` (new; the 5 `NodeType`
  literals move here from `nodetypes.go`, the 5 `switch` cases move
  here from `triggerservice.go`)
- `triggerservice.go` — `start()` shrinks to a registry lookup; loses
  the 5 cases and the `NodeType` literals it never actually held
  (those move out of `nodetypes.go`, not out of this file, since they
  were never here)

**Migration sequence** (small, verifiable steps, not one giant diff —
CLAUDE.md's own "small, reviewable steps" rule): (1) add the empty
`composition` registry, verify build + full test suite unchanged
(pure addition, zero behavior change possible); (2) migrate
`integration-http`/`list-lookup`/`mcp-tool-call` first — already the
most isolated, proves the pattern end-to-end on real node types before
touching the rest; (3) migrate the remaining `composition`-package node
types (capture/process/apply×2/decision); (4) once `nodetypes.go`'s
literal slice and `execute.go`'s literal map are both empty, flip
`NodeTypes()`/`ExecuteWorkflow` to read the registry — this is the one
step where the old and new mechanisms must not coexist even briefly,
since a node type present in the old slice but not yet registered (or
vice versa) would silently vanish or duplicate; (5) migrate the 5
Trigger types into `package main`, add the `main`-package registry,
flip `TriggerService.start()`; (6) full verification — `go test
./...`, `golangci-lint run ./...`, the complete Playwright e2e suite,
plus a manual desktop-mode smoke pass for `TriggerService` specifically
(per SPEC.md §1.3, `HotkeyService`/`TriggerService`'s live listener
paths aren't exercisable by headless CI at all, registry refactor or
not). Grouped into roughly 2-3 commits (registry + composition-package
migration; trigger migration; any follow-up), not 14 file-by-file
commits — the seam is real but the whole thing is one coherent,
verifiable change, not fourteen independent ones.

**Explicitly not touched by this plan**: Connector `AuthType`,
Configure-entity-kind registration (both already scoped out of A1 in
the Decision above) — nothing about this implementation plan revisits
that scope, it's still the small-and-accepted cost this ADR's Decision
section already settled.

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
