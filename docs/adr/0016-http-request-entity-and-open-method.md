# ADR-0016: Rename Connector to HTTPRequest; open the Method field

Status: accepted

## Context

Live in the running app, the user flagged that a seeded connector's
Method was undiscoverable: it only appeared once you switched the
Schema section away from its default "Paste OpenAPI" mode into "Manual
editor," and even there it was a closed 5-value `Select`
(`GET/POST/PUT/PATCH/DELETE`, `frontend/src/configure/
ManualSchemaEditor.tsx`'s `HTTP_METHODS` constant, mirrored by
`internal/domain/composition/integration.go`'s `integration-http`
NodeType `FieldOptions`). Root cause: Mill modeled a connector as
"declare an OpenAPI-shaped schema," which makes Method a side effect of
schema authoring instead of the first, obvious field a request needs.

Researched before proposing a fix (CLAUDE.md's Research → Plan →
Implement, and the standing "don't guess a UI, check real precedent"
discipline this doc already applies elsewhere):

- **Postman** models a request as Method (an open field, not a closed
  list) + URL, then Params/Authorization/Headers/Body/Scripts/Settings
  tabs. Body types: none/form-data/x-www-form-urlencoded/raw
  (text/JSON/XML/HTML/JS)/binary/GraphQL. Auth catalogue: No
  Auth/API Key/Bearer/Basic/Digest/OAuth1/OAuth2/AWS
  SigV4/Hawk/NTLM/Akamai EdgeGrid/ASAP.
- **Bruno** (`.bru`, MIT, git-friendly, no-cloud — architecturally the
  closest existing precedent to Mill of anything surveyed) models the
  same shape as plain text blocks: a method block
  (`get/post/put/delete/patch/options/head/connect/trace`, **or** an
  explicit `http` block with `method: CUSTOM` as an open escape hatch)
  → `params:query`/`params:path` → `headers` → one of
  `body:json/text/xml/graphql/sparql/form-urlencoded/multipart-form/file`
  → `auth` (none/basic/bearer/apikey/digest/awsv4/oauth2).
- **RFC 10008 — the HTTP `QUERY` method** (published June 2026, an
  ~11-year-old draft): safe + idempotent like `GET`, but carries a
  request body like `POST`, for large/structured read-only queries
  that don't fit in a URL. Requires `Content-Type`; servers advertise
  accepted formats via a new `Accept-Query` response header; cache key
  must include the body. Confirms directly, not hypothetically, that a
  closed method enum is the wrong shape — a real, current method Mill's
  two hardcoded 5-item lists cannot express without a code change.
- Sources: [Postman request basics](https://learning.postman.com/docs/use/send-requests/create-requests/request-basics),
  [Postman auth types](https://learning.postman.com/docs/use/send-requests/authorization/authorization-types),
  [Bruno .bru syntax](https://usebruno-bruno.mintlify.app/api/bru-syntax),
  [RFC 10008](https://www.rfc-editor.org/info/rfc10008/).

Both surveyed tools converge on the same two findings that matter here:
Method is never a closed enum, and Params/Body/Auth are peers on one
request object, not buried behind a schema-authoring mode switch.

## Decision

**Rename the domain entity from `Connector` to `HTTPRequest`,
end to end** — decided directly with the user (not silently picked):
"Connector" is reserved going forward as the umbrella term docs/SPEC.md
§4.1 already uses for future connector *kinds* (DB, Python-function,
etc.); today's HTTP-specific entity gets its own name instead of
sharing one increasingly-overloaded noun, matching Postman/Bruno's own
top-level noun ("Request") for exactly this shape. This is a **flat**
rename, not a new two-tier split: one `HTTPRequest` still carries
BaseURL + Auth + Headers + JOSE + Method + Params + Body together, the
same shape `Connector` had — reuse across requests stays via Duplicate
(already built, ADR-0013), not a new shared-base-config layer. Go type
name is `HTTPRequest` (not bare `Request`) specifically to avoid a
same-package collision with `net/http.Request` and
`httpconnector.Request` (the existing low-level execution-adapter type,
unrelated and **not** renamed — it's a thin, non-user-facing
`net/http` wrapper, not the Configure-authored entity).

**Open the Method field.** Both `HTTP_METHODS` (TS) and
`integration-http`'s `FieldOptions` (Go) become a text field with the
eight standard methods (`GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD
/QUERY`) offered as datalist suggestions, not a closed `Select` —
matching Bruno's own "named methods, or an open `CUSTOM` escape hatch"
shape. Any string is accepted and sent as-is; Mill does not validate
against a method allowlist, since the whole point is not needing a
Mill code change for a new or uncommon method (`QUERY`, `TRACE`,
`CONNECT`, a vendor-specific verb).

## Scope — three phases, one goal, no hard stop between them

Decided directly with the user after sizing the actual blast radius
(33 Go files, 13 Go test files, 13 TS files, 10 e2e specs, 11 ADRs
referencing "connector"): combined into one goal rather than split
across sessions, since the rename and the builder rework touch the
same files anyway. Each phase is its own commit(s), fully verified
before the next starts.

- **Phase A (this ADR's own primary content)**: the mechanical
  `Connector` → `HTTPRequest` rename across Go + TypeScript + Wails
  bindings, a real migration for already-persisted data (this dev
  machine's own `~/Library/Application Support/mill/settings.json`
  holds real seeded/edited connectors today — not a throwaway
  prototype key like `composition-workflows-v2`'s own precedent),
  e2e specs updated to match. Zero UX/behavior change — a pure rename,
  verified byte-identical.
- **Phase B**: the actual Postman/Bruno-shaped request builder —
  Params tab (query/path key-value rows, replacing the raw path
  string), a Body-type picker (raw+format/form-data/
  x-www-form-urlencoded/binary/GraphQL, replacing the one literal
  `bodyTemplate` string) as the default authoring UI. OpenAPI-paste and
  CSV import stay as accelerators for the schema-typing use case
  (Attribute binding, ADR-0007 Phase 3), not the only door to Method.
- **Phase C**: `QUERY` support end-to-end — confirm `httpconnector`
  and `net/http`'s client correctly send a body on a non-POST/PUT
  method (Go's `net/http.NewRequest` already supports this for any
  method; needs a real test, not an assumption), and that the open
  Method field surfaces `QUERY` as a suggested option.

## Explicitly out of scope (named, not silently dropped)

Per the capability map reviewed with the user: variables/environments
(`{{var}}` interpolation — real gap, but overlaps Mill's existing
Attribute/binding model enough to need its own design, not a
copy-Postman decision); pre-/post-request scripts (a JS sandbox is a
large, real NIH-risk decision — e.g. a pure-Go JS VM like `goja` would
need its own research pass); collections/folders (grouping with
inherited auth); the remaining Postman/Bruno auth types not already in
ADR-0015's 9-value catalogue (plain Basic Auth, Digest, AWS SigV4,
NTLM, Hawk). None of these are touched by this ADR.

## Migration for persisted data

- **Settings-store key**: `configureservice.go`'s `connectorsKey =
  "configure-connectors"` becomes `requestsKey = "configure-requests"`.
  Unlike `composition-workflows` → `-v2`'s precedent (intentionally
  orphaned prototype data), this key holds real current data — `
  restore()` migrates forward: if `requestsKey` has nothing, check the
  old `configure-connectors` key; if that has data, unmarshal and
  persist it under the new key; only fall through to
  `httprequest.BuiltIn()` seeding if neither key has anything (a
  genuinely fresh install). The old key is left in place, unread after
  migration — no `Delete` exists on the `settings.Store` port, and a
  stale unread key is harmless.
- **OS keychain namespace**: `internal/adapters/credential`'s `service
  = "mill-connector"` constant is deliberately **left unchanged** —
  it's an internal, never-user-visible namespace token (the "user"
  half of the keychain entry is already the request's own ID, which
  doesn't change in a rename); changing it would require its own
  migration for zero user-facing benefit, pure risk with no payoff.
  Its doc comment is updated to record this reasoning so it isn't
  "fixed" to match the new name later without re-deriving why it
  wasn't.

## Consequences

- Every Wails-bound RPC gains a new name (`CreateConnector` →
  `CreateHTTPRequest`, etc.) — the generated TS bindings regenerate
  automatically (`wails3 generate bindings`), no hand-maintained
  binding file to update.
- `EntityRefField.tsx`'s `RefKind` value `"connector"` becomes
  `"request"`; `integration-http`'s `connectorId` config key becomes
  `requestId`; `composition.SetConnectorLookup`/`ResolvedConnector`
  become `SetHTTPRequestLookup`/`ResolvedHTTPRequest`.
- The now-redundant `Connector.Type`/`TypeHTTP` field is dropped
  entirely (not renamed) — the entity name itself now encodes "this is
  HTTP," so a single-value discriminator field is dead weight, same
  "no field for a decision that doesn't exist" reasoning already
  applied elsewhere in this codebase (single-option `Select`s).
- Existing ADRs (0007, 0009, 0011, 0013, 0014, 0015) that narrate
  "Connector" as history are **not** rewritten — matches this repo's
  own established practice (docs/SPEC.md §9.1: historical decision
  records stay as written, new content follows new terminology). A
  short pointer note is added to each so a reader lands on the current
  name.

## Update — Method opened (Phase B's method half + Phase C), Params/Body-type builder still open

Phase A landed as its own commit (rename + migration, verified
byte-identical). This update covers the Method-opening half of Phase B
plus all of Phase C — **not** the Params tab / Body-type picker, which
is real, separately-sized future work, named below rather than rushed.

- **`ConfigField` gained `Suggestions []string`**
  (`internal/domain/composition/types.go`), orthogonal to
  `Options`/`FieldOptions`: meaningful only for `FieldText`, and
  non-restrictive — any value is still accepted, these are
  autocomplete hints only. `integration-http`'s `method` field is now
  `Type: FieldText, Suggestions: httpMethodSuggestions` (`GET/POST/
  PUT/PATCH/DELETE/HEAD/OPTIONS/QUERY`) instead of a closed
  `FieldOptions` 5-item list — `ResolveNodeDefaults`
  (`nodetypes.go`) only enforces a closed set for `FieldOptions`, so a
  `FieldText` value was already unconstrained server-side; the only
  change needed was the field's own `Type`.
- **Frontend**: `NodeInspector.tsx` gained a new render branch —
  `FieldText` with `Suggestions` renders a single-line `TextInput`
  with `list="<key>-suggestions"` plus a sibling `<datalist>`, instead
  of falling through to the generic 4-row `Textarea` every other
  `FieldText` field (correctly still) uses. Verified directly (not
  assumed) that Primer's `TextInput` spreads unrecognized props onto
  the real `<input>` (`TextInputProps = Merge<React.
  ComponentPropsWithoutRef<'input'>, ...>`), so `list` reaches the DOM.
- **`QUERY` support end-to-end, proven not assumed (Phase C)**: Go's
  `net/http`/`retryablehttp.NewRequest` don't special-case method when
  attaching a body — no code change was needed in
  `internal/adapters/httpconnector`, only a real test proving it
  (`TestExecute_QueryMethod_SendsBody`, a real `httptest.Server`
  confirming both the method string and body arrive unmodified) plus a
  composition-layer regression test through the real
  `ExecuteWorkflow` path
  (`TestExecuteWorkflow_IntegrationHTTP_QueryMethod_Accepted`).
- **Manual Schema Editor's own, separate Method field** (`frontend/
  src/configure/ManualSchemaEditor.tsx`'s `HTTP_METHODS`, used when
  declaring an OpenAPI-backed operation, not the raw workflow-node
  field above) — extended to all 8 methods `kin-openapi`'s `PathItem`
  struct actually has fields for (`Get/Put/Post/Delete/Options/Head/
  Patch/Trace`, verified directly against `openapi3/path_item.go`),
  adding the 3 that were missing (`HEAD`/`OPTIONS`/`TRACE`).
  **Deliberately does not include `QUERY`** — checked directly, not
  assumed: `kin-openapi`'s `PathItem` is a fixed Go struct with exactly
  those 8 method fields, no generic bucket and no `QUERY` field, since
  OpenAPI 3.x has no spec-defined field for RFC 10008's method yet. An
  operation declared through the schema-authoring path has to stay
  representable as a real OpenAPI document; `integration-http`'s own
  literal Method field above is unconstrained by this and is where
  `QUERY` actually gets used.
- **Verified end-to-end**, not just unit-tested: a new
  `frontend/e2e/request-method-field.spec.ts` drags an
  `integration-http` node onto a real canvas (server mode + Playwright,
  real Go bindings), confirms the Method field renders as a plain
  `<input>` (not a `<select>`) with `QUERY` genuinely offered in its
  datalist, sets it, saves the workflow, reopens it via Edit, and
  confirms `QUERY` survived the real persist/restore round trip — not
  just left in the input's own local DOM state.
  `frontend/e2e/integration-bindings.spec.ts`'s own existing Method
  interaction (`.selectOption('POST')`, written for the old closed
  `Select`) was updated to `.fill('POST')` — caught as a real breakage
  by running the existing suite, not assumed compatible. Full Go
  build/vet/test/lint (both build tags) and the complete 58-test
  Playwright suite (57 + this new spec) run twice, no leakage.

**Still `OPEN`, real future work, not silently dropped**: the Params
tab (query/path key-value rows, replacing the raw `path` string field)
and the Body-type picker (raw+format/form-data/x-www-form-urlencoded/
binary/GraphQL, replacing the one literal `bodyTemplate` string) —
Phase B's own bigger, genuinely separate design surface. `bodyTemplate`
and `path` stay exactly as they were (plain `FieldText`, no
`Suggestions`) in this update; only `method` changed shape.

## Update 2 — Phase B's entity half shipped; 1:1 request:operation locked

Prompted directly in the live app ("I don't see anywhere that I can
set METHOD" — the exact discoverability complaint this ADR's Context
opened with, still true for the *entity* even after the node-level
method opened): `HTTPRequest.Method` is now a real entity field —
open text, empty-means-GET — set beside Base URL at the top of the
request form (the Postman/Bruno request row this ADR's own Decision
already named as the target shape). Wire shape (export/import), seeded
examples, and the read-only summary all carry it;
`integration-http`'s own `method` config field became an optional
per-step override (blank inherits the request's method; nodes saved
before this change carry the old explicit "GET" default and behave
identically — regression-tested via
`TestExecuteWorkflow_IntegrationHTTP_MethodFallsBackToRequests`).

Two further decisions, made directly with the user in the same pass:

- **A request is 1:1 with its operation.** "Do we ever want a single
  request to have multiple operations? … people clone to create
  another." The manual schema editor no longer has an "Add operation"
  button; a single-operation request's schema shows no Method control
  at all (the operation's method IS the request's Method, clamped to
  OpenAPI's 8 expressible methods only at document-synthesis time —
  execution always sends the real method, QUERY included). A stored
  multi-operation spec still renders fully and can be pared down —
  never grown — so no existing data is silently dropped.
- **One schema-intake block** (`SchemaIntake.tsx`, react-dropzone)
  replaces the Paste-OpenAPI/Manual mode switch, the CSV block, and
  the per-section Paste-sample toggles — content-detected paste/drop
  (OpenAPI / JSON sample / CSV) landing in the always-visible manual
  editor; the raw document stays behind a "View raw OpenAPI"
  disclosure and saves byte-verbatim unless the schema was actually
  edited.

**Still open after this update**: the Body-type picker
(raw+format/form-data/x-www-form-urlencoded/binary/GraphQL, replacing
the literal `bodyTemplate` string) and query/path key-value Params
rows replacing `integration-http`'s raw `path` string — the schema's
typed Parameters table covers declaring them, but the node-level
authoring UI is unchanged.
