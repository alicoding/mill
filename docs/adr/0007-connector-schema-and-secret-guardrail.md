# ADR-0007: Connector input/output schema (OpenAPI) + secret guardrail

## Status
accepted — all three phases built, see Consequences's Update

## Context

SPEC.md §3.5/§3.3/§4 already built a real Connector (auth/base URL/
headers, Configure-authored, 1:many reusable) and an `integration-http`
node that references one by ID. What's missing, raised directly by the
user and confirmed by reading the actual code (not assumed): the node's
`bodyTemplate` is a raw literal string with no binding to the workflow's
own Attributes, and the HTTP response overwrites `ExecContext.Payload`
wholesale instead of landing in named output Attributes a Decision node
or anything downstream could reference. `list-lookup` already proves the
underlying mechanism works for a trivial case (`inputKey`/`outputKey`
config fields reading/writing `ctx.Attributes`); `integration-http`
predates that pattern and was never brought up to the same level.

The user described the model to match, from professional experience with
a no-code decisioning platform (kept anonymized per this doc's own
standing rule): at Configure time, the Connector/Integration definition
declares the input schema (what fields this integration needs) and
output schema (what it returns), plus owns secret/auth/header/payload
mechanics; at workflow-authoring time, a node just binds which Attribute
supplies each declared input field and which Attribute receives each
declared output field. Explicit instruction: adopt an existing standard
for this, don't invent a bespoke schema — "the most opinionated
framework," not a hand-rolled DSL.

A full research pass (dispatched to research-cap, findings already
folded into SPEC.md's §3.3/§3.5/§4 rows) answered the adopt question.
This ADR turns that research into a locked, implementable design and
resolves the three risks the research itself flagged as unverified.

## Decision drivers
- CLAUDE.md/`.claude/rules/architecture.md`: adopt over hand-roll,
  swappable behind a ports/adapters boundary, core domain (the
  Node/Attribute binding semantics) stays Mill's own hand-written code.
- No third schema representation: Mill already has `composition.
  AttributeDef` (workflow Attributes) and JSON Schema (MCP tool
  `InputSchema`, §3.6) — a Connector schema needs to reuse one of these
  shapes or a real standard, not add a fourth ad hoc format.
- Single binary, no Rust, no cgo, no separate daemon (§1.1).
- Secrets must never reach DBOS's persisted step checkpoints in
  plaintext (a new risk surfaced by this same research pass, since
  §7's DBOS integration checkpoints the full `ExecContext` per node).

## Research summary (full detail already in SPEC.md §3.3/§3.5/§4; not
repeated verbatim here)

**Adopt OpenAPI 3.x, parsed at runtime with `github.com/getkin/kin-openapi`
(MIT, pure Go, the converged parser in the Go OpenAPI ecosystem —
`oapi-codegen` itself depends on it just for parsing).** OpenAPI is the
only format that expresses input schema *with HTTP placement*
(`parameters[].in` = path/query/header/cookie, plus `requestBody`
schema) and output schema (`responses[].content[].schema`) in one
document — plain JSON Schema alone can't express placement, which would
leave Mill inventing exactly the bespoke mapping DSL the user said not
to build. `oapi-codegen` itself was checked and rejected: compile-time
codegen against a spec fixed at build time, wrong shape for a connector
a user adds at runtime.

**Secrets**: `go-keyring`-via-OS-keychain (already adopted, §3.5) is
sound; the real, confirmed gap is that nothing today stops a resolved
secret from landing in `ExecContext.Attributes`/`Payload` and being
checkpointed to DBOS's SQLite file in plaintext once request/response
fields become dynamically Attribute-bound (this ADR's own feature).
Temporal's pattern (encrypt/exclude *before* persistence) is the right
shape; n8n's "execution data redaction" was checked and rejected —
it's read-time display filtering, the plaintext still hits disk.

## Decision

### 1. Schema storage: extend `Connector`, don't create a new entity

`internal/domain/connector.Connector` gains one new field:

```go
type Connector struct {
    ID       string
    Label    string
    Type     string
    BaseURL  string
    AuthType AuthType
    Headers  map[string]string
    // OpenAPISpec is the raw OpenAPI 3.x document (JSON or YAML) this
    // connector's operations are declared against -- optional. A
    // Connector with no spec behaves exactly as it does today (raw
    // path/method/bodyTemplate config on the node, unchanged) --
    // additive, not a breaking migration for existing Connectors.
    OpenAPISpec string
}
```

Not a separate "operation" entity per-connector-per-endpoint: one
Connector = one spec document, and a `integration-http` node picks
*which operation* (path + method) from that spec at node-config time —
this matches the existing 1:many Connector-reuse cardinality (§3.5)
without introducing a second Configure-authored entity kind for what's
still fundamentally "one API, one auth, many callable operations."

### 2. New adapter: `internal/adapters/openapispec`

Wraps `kin-openapi`'s `openapi3` + `openapi3filter` packages behind
Mill's own names, same shape as `internal/adapters/mcpclient` for the
MCP Go SDK (no other Mill package imports `kin-openapi` directly):

```go
func Parse(doc []byte) (*Document, error)
func (d *Document) Operations() []OperationRef  // {Path, Method, Summary}
func (d *Document) Operation(path, method string) (*Operation, error)

type Operation struct {
    InputFields  []Field  // from Parameters + RequestBody schema
    OutputFields []Field  // from the 2xx response's schema
}
type Field struct {
    Name       string
    In         string // "path" | "query" | "header" | "body"
    Type       string // "string" | "number" | "boolean" | "object" | "array"
    Required   bool
    IsSecret   bool   // true if this field's Parameter/Schema carries
                       // x-mill-secret: true, or its name matches the
                       // connector's own AuthType-implied header
                       // (Authorization, X-Api-Key) -- see §4 below
}
```

`Field.IsSecret` is the hook the secret guardrail (§4) reads — computed
once at parse time, not re-derived ad hoc at validate time.

### 3. `integration-http` node config: replace the literal `bodyTemplate`
with declared field bindings

New `ConfigField` shape needed beyond today's flat `Key/Label/Type`:
a `FieldBinding` config type whose value is JSON-encoded
`map[string]string` (declared field name → either a literal or an
`attr:<name>` reference into `ctx.Attributes`), stored in `Node.Config`
under a fixed key (`"inputBindings"`). Output side: `"outputBindings"`,
a JSON-encoded `map[string]string` (declared output field name → the
workflow Attribute name to write it into). Deliberately reuses
`Node.Config`'s existing `map[string]string` shape (a JSON-encoded
value inside one of its string values) rather than widening `Node`'s
own struct — smallest change that fits the existing persisted-workflow
shape, matching how `Decision`'s edge conditions already live as a
string inside `Edge`, not a new field.

Execution (`internal/domain/composition`'s `integration-http` exec
function): resolve `inputBindings` against `ctx.Attributes` (or a
literal) into the real HTTP request per each field's declared `In`
placement (path template substitution, query string, header, or JSON
body field) using `openapispec`'s `Operation` to know where each field
goes; on response, decode the body per the operation's output schema
and write each `outputBindings`-mapped field into `ctx.Attributes`.
A Connector with no `OpenAPISpec` keeps today's exact behavior
(`path`/`method`/`bodyTemplate` literal, `ctx.Payload` overwrite) —
this is a strict superset, not a breaking change to existing workflows.

### 4. Secret guardrail: `ValidateGraph` rejects at save time, not a
new library

`composition.ValidateGraph` (already the save-time compile-check home
for Decision conditions) gains one more check: for every
`integration-http` node with `outputBindings`, if the source field's
`openapispec.Field.IsSecret` is true, reject the save with a named
error ("field %q is a secret field and cannot be written to a workflow
Attribute"). This is the concrete guardrail the research recommended —
code Mill already owns, not a new dependency, applied at the exact
point a save-time error already stops an invalid graph today (mirrors
Decision's own "a save-time error and a run-time error never
disagree" discipline, §3.3).

`Field.IsSecret` determination (kept simple, no new authoring UI needed
for v1): true if the field's `In` is `"header"` and its name
case-insensitively matches `"Authorization"` or the connector's
configured API-key header name (`X-Api-Key` by default, per
`integration.go`'s existing `authHeader` mapping) — i.e. exactly the
two header names Mill's own `AuthType` resolution already injects, not
a speculative general "any field could be secret" classifier.

## Consequences

- **Locks**: `kin-openapi` as the OpenAPI parsing/validation library;
  `Connector.OpenAPISpec` as the schema-storage shape; the
  input/output-field-binding config shape on `integration-http`; the
  `ValidateGraph` secret-guardrail hook point.
- **Phased implementation, not all in one pass** — revised once during
  implementation itself (recorded honestly, not silently): the secret
  guardrail (§4) turned out to be coupled to Phase 3's exact
  input/output-binding config shape (`ValidateGraph` needs to resolve a
  node's declared bindings to know which fields are secret-classified,
  and that config shape doesn't exist until Phase 3 builds it) — moved
  from Phase 2 into Phase 3 rather than inventing a throwaway binding
  format early just to exercise the guardrail in isolation.
  - Phase 1 (this session, done): `internal/adapters/openapispec`
    (parse + list operations + field extraction incl. the `IsSecret`
    classifier, real tests against a real OpenAPI document — including
    a real bug the tests caught, a naive substring match missing
    `"X-Api-Key"` because of the hyphen — no UI yet).
  - Phase 2 (this session, done): `Connector.OpenAPISpec` field +
    Configure UI to set it + a "List operations" surfacing (mirrors the
    MCP Server Configure entity's existing "List tools" button, §3.6 —
    the same discoverability answer, not a new pattern). No node-level
    binding UI yet — `integration-http` is unchanged in this phase.
  - Phase 3 (done): the `integration-http` Inspector's field-binding UI
    (`IntegrationBindingsEditor.tsx`) **and** `ValidateGraph`'s secret
    guardrail (`validateOutputBindingSecrets`, graph.go), built
    together as planned once the binding config shape existed.
    `path`/`method` double as the operation selector (matching a
    declared operation surfaces the editor; no new picker UI needed)
    rather than a separate "pick an operation" control — a smaller
    change than originally sketched, and consistent with `path`/
    `method` already being the literal-mode config those two fields
    have always been. Each input field offers a real Select of the
    workflow's declared Attributes (not raw text entry as originally
    scoped here) plus a literal-value fallback — the same live-picker
    upgrade ADR-0009 gave `connectorId`/`listId`/`mcpServerId`, applied
    to this binding editor too rather than left at the weaker gap this
    section originally accepted. Real regression tests cover input
    resolution (path/query/header/body placement), output-Attribute
    writes proven via a downstream Decision routing on the bound value,
    and both the accept and reject paths of the secret guardrail.
    Verified end-to-end via Playwright
    (`integration-bindings.spec.ts`): a secret output field renders
    labeled and unbindable, not silently omitted.
- **Not solved here, named explicitly**: a Postman-collection import
  path (real library exists, `rbretecher/go-postman-collection`, but
  flagged stale by the research — deferred, not adopted).
- **Risk carried forward, resolved**: `kin-openapi`'s request-
  construction fit was the named spike-needed risk — Phase 3's real
  tests (a live `httptest.Server` receiving path/query/header/body
  values resolved from bindings) confirm it holds.

## Lifecycle
- Owner: Ali
- Maintains: the OpenAPI/kin-openapi pick, the secret-guardrail rule,
  the input/output binding config shape (`inputBindings`/
  `outputBindings` JSON in `Node.Config`)
- Update triggers: a real workflow hitting the Postman-import gap;
  kin-openapi going unmaintained; a second connector `Type` needing a
  different binding-placement model than path/query/header/body
- Last reviewed: 2026-08-08
- Review interval: 90 days
