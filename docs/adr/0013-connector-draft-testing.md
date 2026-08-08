# ADR-0013: Connector draft testing (test-before-save, sample payloads, request log, duplicate)

## Status
accepted

## Context

Raised directly by the user, after ADR-0011's schema-authoring pass:
"when you in the edit mode, we need to think about how do we test a
connection and the payload using example... this can be done after you
define your input and output. and you're able to see what the error for
each request and append the logs... when you actually finish your
configuration without having to save yet, you can test the current
draft and also you can clone what you have already done for the
existing HTTP connector as well." Four distinct asks bundled together,
kept separate below since they have different answers:

1. Test an operation against the real API using a generated example
   payload.
2. See each test attempt's result (status/error), accumulating as a log
   across multiple attempts in one editing session.
3. Test the **current draft** — before Save exists as a persisted
   Connector at all.
4. Duplicate/clone an existing connector's configuration into a new one.

## Decision

### 1. Testing runs through a new Go RPC, not a browser `fetch`

A connector call needs the resolved secret (OS keychain) and, for a
new/edited connector, must not trip CORS against an arbitrary
third-party API the browser has no preflight relationship with —
both already-solved problems for the real `integration-http` node path
(`internal/domain/composition/integration.go`), which runs server-side
through `httpconnector.Execute`. `ConfigureService.TestConnectorOperation`
(`configureservice.go`) reuses exactly that path rather than teaching
the frontend a second, browser-side HTTP client. `LOCKED`

### 2. A new `openapispec.BuildRequest`, not `composition`'s
`resolveInputBindings`

`resolveInputBindings` (`internal/domain/composition/attributebinding.go`)
resolves a *workflow node's authored bindings config* (a map of field
name → literal-or-`$attr.path`-expression) against a running
workflow's `Attributes` — the wrong input shape here, since a
connector test has no workflow, no bindings config, and no Attributes;
it has a flat `map[string]string` of already-concrete example (or
user-edited) values keyed by field name. Genuinely different input,
same underlying job (turn `Operation.InputFields` + values into a
path/query/headers/body) — a new `openapispec.BuildRequest(pathTemplate,
op, values)` lives in the `openapispec` adapter package itself (it only
needs an `Operation`, no `ExecContext`/domain dependency), callable by
both the new test RPC and, potentially, a future non-workflow test
surface. `resolveInputBindings` is untouched. `LOCKED`

### 3. Testing a draft: the frontend sends the full draft as request
parameters, no save required

`TestConnectorOperation`'s request carries `BaseURL`/`AuthType`/
`Headers`/`OpenAPISpec` as plain values (exactly `ConnectorForm`'s
in-memory `ConnectorDraft`), not a Connector ID — the RPC never reads
`c.connectors` for the connector's *config*, only (per #4 below) for a
secret fallback. This makes "test what's on screen right now" the
default shape rather than a special case: creating a brand-new
connector and testing it before the first Save works identically to
testing an existing one mid-edit. `LOCKED`

### 4. Secret handling: draft-supplied first, keychain fallback second,
nothing persisted by testing

`ConnectorDraft.secret` is already write-only and cleared on every edit
open (ADR-0007/§3.5's existing design — `startEdit` never pre-fills
it). Two real cases:
- **Editing an existing connector, secret field left blank** (the
  common case — "keep the existing secret"): the request also carries
  the connector's `ConnectorID`; if `Secret` is empty and `ConnectorID`
  is set, the RPC falls back to `credential.Get(id)`, the exact keychain
  read `resolveConnector` already does for real workflow runs. Nothing
  new persisted — this is a read, not a write.
- **A brand-new connector, or a secret being changed**: `Secret` is
  used as typed, exactly once, for this call only. **Testing never
  calls `credential.Set`** — a user who tests-then-abandons a draft
  leaves no keychain trace, matching the existing "Save is the only
  thing that persists" contract `SetConnectorSecret` already has as a
  separate, explicit call. `LOCKED`

### 5. Sample payload generation reuses the already-adopted
`zod-schema-faker`, via a new field-shape adapter

`configSchema.ts`'s `generateSamplePayload` already does "typed field →
zod schema → `fake()`" for `ConfigField`/`AttributeDef` (§3.4). An
`openapispec.Field` carries OpenAPI's own type vocabulary
(`string`/`number`/`integer`/`boolean`/`object`/`array`), not
`ConfigFieldType`'s (`text`/`number`/`boolean`/`options`) — different
enough (and object/array need no nested-fake generation, matching the
project's existing "no wildcard-over-nested-structure" restraint from
the output-Path extraction work, ADR-0011) that forcing it through the
existing adapter would either lose information or need its own
translation layer either way. `frontend/src/configure/testPayload.ts`
is a small, dedicated `Field[] → Record<string,string>` generator,
same `zod` + `zod-schema-faker` library calls, new mapping — not a
second schema library adopted, just a second small adapter over the
one already-vetted library. Lives in `configure/` (bounded-context
folder, ADR-0012), not `shared/`, since nothing outside Configure's
connector-testing UI needs it. `LOCKED`

### 6. The request/response log is session-local UI state, not
persisted

"See the error for each request and append the logs" is satisfied by
an in-memory array in a new `ConnectorTestPanel.tsx` (`configure/`),
cleared when the form closes — the same tier of ephemeralness Mill
already uses for in-session, non-durable feedback (Activity's own
session-only ring buffer, §2.2). Not routed through
`internal/adapters/settings` or DBOS: a test-call log has no value
after the editing session ends (unlike a real workflow *run*, §7's
Runs page, which is deliberately durable) — persisting it would be
config surface for a decision nobody asked for, the same restraint
§3.5's Configure recheck already applied elsewhere. Revisit only if a
real need for cross-session test history surfaces. `LOCKED`

### 7. Duplicate/clone is frontend-only, no new backend method

"Clone what you have already done for the existing HTTP connector" —
a **Duplicate** button next to Edit on each connector row
(`ConfigureIntegration.tsx`) opens the create form (`editingID = null`,
so Save calls `CreateConnector`, not `UpdateConnector`) pre-filled from
the source connector's `Label` (suffixed " copy"), `BaseURL`,
`AuthType`, `Headers`, and `OpenAPISpec` — everything already visible
to the frontend as plain `Connector` fields. `Secret` is **not**
copied: it was never readable in the first place (§3.5's write-only
design), so "duplicate" naturally can't carry it forward; the new
connector's Auth tab shows the normal "enter a secret" state, not a
false "leave blank to keep existing" caption (which only makes sense
mid-edit of the *same* connector). No backend RPC needed — this is a
plain object copy of data the frontend already has in memory from
`Connectors()`. `LOCKED`

## Consequences

- New Go: `openapispec.BuildRequest` (own package, own test),
  `ConfigureService.TestConnectorOperation` + its request/result types.
- New frontend: `configure/testPayload.ts` (+ test),
  `configure/ConnectorTestPanel.tsx`, a "Duplicate" action in
  `ConfigureIntegration.tsx`, a new "Test" tab in `ConnectorForm.tsx`
  alongside General/Auth/Headers/Schema.
- `internal/domain/composition/integration.go`'s unexported `authHeader`
  is exported to `AuthHeader` so the test RPC reuses the identical
  AuthType→header-name mapping instead of a second, driftable copy —
  the only change to existing node-execution code in this pass.
- Does not touch `resolveInputBindings`/`applyOutputBindings` (workflow
  node execution) at all — this is a wholly additive, Configure-only
  surface.
- A test call is subject to the same `httpconnector` timeout/retry
  policy (SPEC.md §4) as a real workflow run — deliberately not
  special-cased faster/slower, since the point is to see how the real
  call actually behaves.
