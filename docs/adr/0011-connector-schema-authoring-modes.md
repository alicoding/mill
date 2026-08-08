# ADR-0011: Sectioned Connector configuration + multi-mode schema authoring

## Status
accepted

## Context

Raised directly by the user, testing the live Configure → Integration
screen: two real gaps beyond the Headers/schema-preview fix already
landed this session. First, the connector form is one flat scrolling
list of fields (Label, Base URL, Auth type, Secret, Headers, OpenAPI
spec) with no separation of concerns — checked against real precedent
(Postman's Params/Headers/Authorization/Body tabs; n8n's HTTP Request
node's Authentication/Query Parameters/Headers/Body sections, where
Body itself offers "Using Fields Below" vs "JSON" as parallel authoring
modes) rather than invented — professional API tooling converges on
sectioning by concern, not one long form. Second, ADR-0007's only
schema-authoring path is pasting a complete, valid OpenAPI 3.x
document by hand — powerful (the only format expressing HTTP
placement, ADR-0007's own reasoning for adopting it) but a real
authoring-cost cliff for someone who just wants to define a couple of
fields. The user named Oscilar's own CSV/JSON/manual-editor modes as
the reference shape to match.

A follow-up round of questions resolved three more specifics, directly
from the user, not inferred:
- **Alias**: a field's wire name (what the API actually calls it) can
  differ from what you want to reference it as later — an alias is
  that friendlier reference name, for both input and output fields.
- **Alias path**: the same concept, extended to nested response data —
  Mill's current output-field extraction (`applyOutputBindings`,
  ADR-0007 Phase 3) only ever reads a flat top-level JSON key; a path
  (e.g. `data.name`) lets a field's value be read from inside a nested
  object without building a full recursive nested-schema editor.
- **Primary key**: explicitly deferred. The user's own answer flagged
  real uncertainty about what it should mean and surfaced no concrete
  consumer (possibly conflating connector-schema authoring with a
  separate, real future question — cross-workflow data access, closer
  to §7's still-open session-identity model than to this ADR's scope).
  Recorded in SPEC.md §10 as a named future item, not built here —
  same "no UI for a decision that doesn't exist yet" discipline
  `AuthType`'s OAuth2 gap and `AttributeDef`'s missing `Options` list
  both already established.

## Decision

### 1. Configure → Integration becomes a tabbed form: General / Auth / Headers / Schema

Reuses the same `Tabs`/`TabList`/`TabPanel` wrapper components already
built for `CompositionView.tsx` (Primer `@primer/react/experimental`
headless hooks) — no new tab mechanism. General holds Label/Base URL;
Auth holds Auth type + Secret; Headers holds the row editor already
shipped this session; Schema is new (below).

### 2. Schema tab: two authoring modes, one underlying representation

A mode toggle (OpenAPI paste / Manual editor) — **not** a third schema
format. Both modes ultimately produce the exact same
`Connector.OpenAPISpec` string the backend already parses
(`internal/adapters/openapispec`) — zero backend changes to the
execution path, only to field extraction (§4 below). This is the same
"no third/fourth schema representation" principle ADR-0007 already
locked, applied to the *authoring* layer instead of the *runtime*
layer.

- **OpenAPI paste**: unchanged, the existing textarea.
- **Manual editor**: a repeatable list of operations (path + method +
  summary), each with an input-fields table and an output-fields table
  — `frontend/src/ManualSchemaEditor.tsx`. A field row: Name, In
  (input only: path/query/header/body), Type, Required (input only),
  Secret, Alias (optional), Path (output only, optional — defaults to
  Name, a flat top-level read). On save, `openapiSynth.ts`'s
  `synthesizeOpenAPISpec` builds the OpenAPI JSON from these rows;
  `Alias`/`Path` are written as `x-mill-alias`/`x-mill-path` vendor
  extensions (OpenAPI's own standard `x-*` extension mechanism,
  confirmed directly against `kin-openapi`'s `Schema`/`Parameter`
  types, both of which already expose a real `Extensions map[string]any`
  field populated from exactly this) — not a hack, the standard's own
  documented extension point.
- **CSV import**: an accelerator *within* Manual mode, not a fourth
  mode — bulk-fills the same operations table instead of typing rows
  one at a time. Columns: `path,method,direction,name,in,type,required,
  secret,alias,path` (one field per row — "table and row," the shape
  the user confirmed) — `direction` (`input`/`output`) lets one CSV
  define fields across multiple operations and both directions at
  once. Parsed with **PapaParse** (MIT, 2.1M weekly downloads,
  maintained since 2012, RFC 4180-correct) — checked directly, not
  assumed: CSV quoting/escaping is a real correctness trap a hand-rolled
  `split(',')` gets wrong on the first embedded comma, exactly the kind
  of thing `.claude/rules/architecture.md`'s adopt-over-hand-roll bias
  exists for, even though the field-row mapping itself stays Mill's own
  code.
- **Review after import**: both CSV and a pasted-then-reparsed OpenAPI
  doc land in the *same* Manual editor table afterward — satisfies the
  user's explicit ask ("if you started as csv or json you will be able
  to review it using the editor"). Reparsing an arbitrary hand-written
  OpenAPI doc back into flat rows is lossy for anything the flat model
  can't express (`oneOf`, deeply nested arrays-of-objects) — accepted,
  named explicitly: the reverse (OpenAPI → table) only round-trips
  cleanly for specs the table itself could have produced.

### 3. `openapispec.Field` gains `Alias` and `Path`

```go
type Field struct {
    Name, In, Type string
    Required, IsSecret bool
    // Alias is a friendlier reference name for this field, read from
    // the x-mill-alias extension -- falls back to Name when unset.
    // Display-only: binding JSON (inputBindings/outputBindings) is
    // still keyed by Name internally, Alias only changes what the
    // Inspector shows a row as. Kept this way deliberately -- a second
    // lookup key (bindings keyed by Alias) would need a canonical-key
    // resolution rule with no real benefit over relabeling display.
    Alias string
    // Path is a dot-separated path into (possibly nested) response
    // JSON for extracting this output field's value -- read from the
    // x-mill-path extension, falls back to Name (a flat top-level
    // read, today's exact existing behavior) when unset. Only
    // meaningful for output fields; input fields are placed by Name at
    // their declared In location, nothing to "extract."
    Path string
}
```

### 4. `applyOutputBindings` gains dot-path extraction

Currently a flat `respObj[fieldName]` lookup. Extended to resolve each
bound field's `Path` (looked up from the connector's parsed
`Operation.OutputFields`, passed in by `integration-http`'s exec
function, which already parses the spec for `resolveInputBindings`)
and walk it: `"data.name"` → `respObj["data"].(map)["name"]`. Scope
explicitly bounded, named here rather than silently assumed complete:
supports nested **object** traversal and numeric array indices
(`"items.0.name"`), not a wildcard-over-array extraction
(`"items[].name"` meaning "one value per array element") — that's a
genuinely different, one-to-many shape (an Attribute holds one scalar
value, not a list) and isn't asked for; a flat/unset `Path` behaves
identically to today.

## Alternatives considered

- **Adopt a visual JSON-Schema editor library** (`react-json-schema-
  form-builder`, `jsonjoy-builder`, `@json-editor/json-editor` —
  checked directly via search, real options). Rejected: all three edit
  generic JSON Schema with no concept of HTTP field placement
  (path/query/header/body), the exact reason ADR-0007 picked OpenAPI
  over plain JSON Schema in the first place — adopting one would mean
  carrying real dependency weight (react-dnd/redux in one case) for a
  shape mismatch requiring a translation layer regardless. The actual
  UI needed (a repeatable row-list form) is the same lightweight
  pattern already used three times in this codebase (Lists' entries,
  the Headers editor, `IntegrationBindingsEditor`'s rows) — genuinely
  the "hand-roll is correct" case, not NIH.
- **A CSV-per-operation shape** (each row = one operation, fields
  packed into the cell). Rejected: needs its own mini-syntax inside a
  CSV cell, exactly the ad hoc format ADR-0007 already ruled against.
- **Primary key, built speculatively now.** Rejected — see Context.

## Consequences

- **Locks**: the tabbed Configure-form shape (reused for future
  Configure entities needing sections); Manual editor + CSV-as-
  accelerator (not a fourth mode) as the schema-authoring UX;
  `Field.Alias`/`Path` via OpenAPI's own `x-*` vendor-extension
  mechanism; PapaParse for CSV parsing.
- Every existing Connector/spec keeps working unchanged — `Alias`/
  `Path` are optional, absent on any spec written before this, and
  `applyOutputBindings`'s flat lookup is exactly what an unset `Path`
  produces.
- **Not built this pass, named explicitly**: primary key (deferred,
  real future item, tracked in SPEC.md §10); wildcard array extraction
  (`items[].name` one-to-many); reparsing an arbitrarily complex
  hand-written OpenAPI doc losslessly back into the flat table (only
  round-trips what the table itself could produce).
