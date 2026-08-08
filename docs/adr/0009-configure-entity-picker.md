# ADR-0009: Live picker + inline quick-create for Configure-authored entity references

## Status
accepted

> **Naming note (ADR-0016):** this ADR predates the Connector -> HTTPRequest rename and is left as written -- "Connector"/"connector" below refers to today's `HTTPRequest` entity.

## Context

Raised directly by the user: Mill's own documented pattern (§3.5:
Connector/List/MCP Server are Configure-authored, 1:many reusable
entities a workflow node references by ID) isn't actually followed by
the UI. Checked directly, not assumed: `integration-http`'s
`connectorId`, `list-lookup`'s `listId`, and `mcp-tool-call`'s
`mcpServerId` are all plain `FieldText` (`internal/domain/composition/
integration.go`, `listlookup.go`, `mcpcall.go`) — a user pastes a raw ID
copied by hand from the Configure page, with no live list and no way to
create the entity from the point of use. This is a known, previously-
accepted stopgap (§3.5/§3.6's own text: "paste the ID from the Configure
page's connector list until a live dropdown lands there") that the user
is now asking to actually close.

The user's own description of the wanted flow: "you always have to
create first before you can use it. You can drag and create new in the
workflow and it will take you to the configure page tab to create a new
one there and in the workflow."

## A real constraint the literal description runs into, found by reading
the code, not assumed

`App.tsx` renders exactly one view component at a time, conditionally
(`{view.kind === 'composition' && <CompositionView/>}`, ... `{view.kind
=== 'configure' && <ConfigureView/>}`) — switching the top-level `view`
**unmounts** the previous one. `CompositionView.tsx`'s open canvas
tabs (`tabs`, `activeTab`) are local component state, not lifted to the
shared Zustand store. A literal "navigate to Configure, create, navigate
back" round trip would silently discard whatever the user was composing
on an unsaved canvas tab the moment they left Composition — a real
data-loss bug, not a style nitpick, and worse for a brand-new
(never-saved) workflow than for one being edited, since there's no
persisted definition to reopen and reconstruct from at all.

Two ways to resolve this, weighed rather than picking the first that
compiles:
1. **Lift enough state to the store to reconstruct the exact tab on
   return** (which workflow/new-draft, which node was selected, full
   in-progress graph). Rejected: an unsaved draft's full node/edge graph
   would have to be serialized into global state on every navigation-away,
   for a feature (jump to Configure, create one entity, jump back) that
   doesn't need the rest of the canvas disturbed at all — solving a
   much bigger problem (draft-state persistence across navigation) than
   this one asks for.
2. **Don't navigate away from Composition at all** — render Configure's
   own creation *as an inline dialog* over the canvas, invoked directly
   from the picker. Still "the same authoring surface Configure uses,"
   just packaged as an overlay instead of full-page routing. This is
   also the converged pattern in the reference products already cited
   elsewhere in this doc — n8n's "+ Create new credential" and Zapier's
   inline connection picker both open an in-place dialog from the node
   config, never route away from the workflow editor. Chosen.

This is a deliberate, reasoned deviation from the literal "takes you to
the configure page tab" wording, not a silent simplification — recorded
here so the reasoning is visible, not just the outcome.

## Decision

### 1. `ConfigField` gains one new optional field: `RefKind`

```go
type ConfigField struct {
    Key, Label, Description, Default string
    Type     ConfigFieldType // unchanged -- still FieldText; the wire
                              // value is still a plain string ID
    Options  []string
    // RefKind marks a FieldText field whose value is the ID of a
    // Configure-authored entity ("connector" | "list" | "mcpserver"),
    // empty for an ordinary text field. Drives which Configure list the
    // frontend's picker fetches and which quick-create form it offers --
    // Type stays FieldText because the *value* is still a plain string
    // ID; RefKind is a second, orthogonal axis (what the string refers
    // to), not a new value representation.
    RefKind  string
}
```

Set on the three existing fields: `integration-http`'s `connectorId`
(`RefKind: "connector"`), `list-lookup`'s `listId` (`"list"`),
`mcp-tool-call`'s `mcpServerId` (`"mcpserver"`). No change to any
node's execution logic — `RefKind` is presentation metadata the
frontend reads, `nodeExec` functions still just read the plain string
ID out of `Node.Config` exactly as today.

### 2. Frontend: one generic `EntityRefField` component, not three

`NodeInspector.tsx`'s field-type switch gains one branch: a `FieldText`
field with a non-empty `RefKind` renders `<EntityRefField>` instead of
a plain `TextInput`. One component, parameterized by `RefKind`, not
three near-duplicate ones — the same "one mechanism, parameterized"
shape `RunKind`/`TypedField` already established this session.

`EntityRefField`:
- Fetches the matching Configure list on mount
  (`ConfigureService.Connectors()` / `.Lists()` / `.MCPServers()`,
  selected by `RefKind`) and renders a `Select` of `ID → Label`,
  current value selected.
- A "+ Create new…" option at the end of the list opens a **quick-create
  Dialog** (Primer `Dialog`, same component `TestRunDialog` already
  established this session) with only the fields required to produce a
  usable entity — not the full Configure page's feature set:
  - Connector: Label + Base URL (auth/headers/OpenAPI spec default to
    None/empty/empty — editable later on the Configure page itself,
    which remains the canonical *full* editing surface).
  - List: Label only (entries added later on Configure).
  - MCP Server: Label + Command (args default empty).
- On successful create, the picker auto-selects the new entity's ID and
  calls the same `onConfigChange` callback a normal selection would —
  from the node's perspective, indistinguishable from picking an
  existing entity.

### 3. Configure stays canonical for full editing — not duplicated

The quick-create dialog is deliberately a subset of each
`ConfigureXxx.tsx` page's own create form, not a copy of it. This isn't
scope-cutting for its own sake: it keeps exactly one place
(`ConfigureIntegration.tsx`/`ConfigureLists.tsx`/
`ConfigureMCPServers.tsx`) owning the full field set (secret, OpenAPI
spec, entries, args) — the quick-create path produces a minimal, valid
entity and hands the user back to their workflow; refining it further
is a normal trip to Configure like any other edit, not a gap.

## Alternatives considered

- **Three separate `ConfigFieldType` values** (`FieldConnectorRef`,
  `FieldListRef`, `FieldMCPServerRef`) instead of one `RefKind` string.
  Rejected: `ConfigFieldType` is a *value-shape* enum (how to parse/
  render the raw string — text/number/boolean/options); "what this
  string refers to" is an orthogonal concern layering on top of
  `FieldText`, not a new value shape, and three enum values would make
  `NodeInspector`'s switch grow a case per entity kind instead of one
  parameterized branch.
- **Full page navigation with lifted draft state** (rejected above,
  §"a real constraint").

## Consequences

- **Locks**: `ConfigField.RefKind` (Go), one generic `EntityRefField`
  frontend component keyed by `RefKind`, quick-create dialogs scoped to
  minimal required fields only.
- Every existing persisted workflow with a `connectorId`/`listId`/
  `mcpServerId` value keeps working unchanged — `RefKind` only changes
  how the Inspector *renders* the field, never the wire shape or
  execution path.
- `EntityRefField` needs its own committed test coverage (a live
  interaction: opening the picker, quick-creating, confirming the new
  ID lands in the node's config) per `.claude/rules/testing.md`, not
  just manual verification.
