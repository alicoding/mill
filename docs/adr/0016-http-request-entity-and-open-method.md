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
