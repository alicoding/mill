# ADR-0015: Connector auth-strategy extensibility + the full auth-type catalogue

## Status
accepted

## Context

Phase 2 of the connector-capability-maturity goal (`docs/SPEC.md` §3.2/
§4.1). The reference-platform research found a real 7-option auth-type
catalogue — None, Header (API key), HMAC, a vendor-specific OAuth 1.0a
variant, "OAuth 1.0 HMAC," OAuth 2.0 (with real sub-config: grant type,
token URL, client ID/secret, scope, token-request content type), and
Query parameter placement — against Mill's current 3
(`none`/`apikey`/`bearer`). mTLS is explicitly out of scope for
implementation this goal (decided directly with the user) but the
architecture must accept it later as a pure addition.

Today's `AuthHeader(rc ResolvedConnector) (key, value string)`
(`internal/domain/composition/integration.go`) can only ever add one
header. That's not expressive enough for the new catalogue: Query
parameter placement needs to write to the URL's query string, not a
header; HMAC and OAuth 1.0a need to *sign* the request (method + path
+ body), not just attach a static credential; OAuth 2.0 needs an async
token fetch with caching, not a synchronous string. The auth mechanism
itself needs to become a real extension point, not a bigger switch
statement.

## Research checkpoint (per the plan's own explicit requirement, done
before writing any HMAC/OAuth-1.0a signing code — not guessed at)

- **OAuth 1.0a is a real, fully-specified standard (RFC 5849)** —
  `oauth_consumer_key`, `oauth_token` (optional), `oauth_signature_method`,
  `oauth_timestamp`/`oauth_nonce` (for HMAC-SHA1/RSA-SHA1). HMAC-SHA1's
  signature is computed over a canonical base string (method + URL +
  sorted, percent-encoded parameters, per RFC 5849 §3.4.1) using
  `consumer_secret & token_secret` as the HMAC key. This is well-specified
  enough to implement fully, and covers what the research called
  "OAuth 1.0 HMAC."
- **The "vendor-specific OAuth 1.0a variant" is not resolvable** — the
  research names its existence but never its actual quirk (a different
  header name, a different parameter set, a different base-string
  convention are all plausible and none confirmed). Implementing a
  guessed variant risks shipping something that silently doesn't match
  the real vendor's expectations, worse than an honest "not yet
  implemented." Scaffolded as its own `AuthType`, stubbed.
- **Generic (non-OAuth) HMAC has no single universal convention** —
  confirmed directly: real implementations vary (custom
  `Authorization: HMAC-SHA256 ...` schemes, `X-Signature`/`X-Timestamp`
  header pairs, `Signature: keyId=...,algorithm=...` per IETF's draft
  HTTP Signatures work). No single "the" standard to adopt. Mill's own
  default, stated explicitly as a default (not a claimed universal
  standard): HMAC-SHA256 over `{method}\n{path}\n{timestamp}\n{body}`,
  base64-encoded, sent as `X-Signature` + `X-Timestamp` headers — a
  common, defensible shape drawn directly from the researched examples.
  A real vendor needing a different convention is real future work,
  same "extend when a real connector needs it" principle §3.2 already
  established for connector protocol support generally.

## Decision

### 1. Auth becomes a registered strategy, not a switch case

```go
type AuthStrategy func(rc ResolvedConnector, method, path string, headers map[string]string, query url.Values, body string) error
```

A package-level registry (`RegisterAuthStrategy(AuthType, AuthStrategy)`,
`ApplyAuth(...)`) in `internal/domain/composition` — the exact
self-registration shape ADR-0006 already established and verified for
NodeTypes/Triggers, applied to a third extension point. Each `AuthType`'s
strategy lives in its own small file (`authnone.go`, `authapikey.go`,
`authbearer.go`, `authhmac.go`, `authoauth1.go`, `authoauth1vendor.go`,
`authoauth2.go`, `authqueryparam.go`, `authmtls.go`), registered via
`init()`. `AuthNone`/`AuthAPIKey`/`AuthBearer` migrate to this shape
with byte-identical behavior — proven by a regression test running the
existing integration-http auth tests unchanged. `LOCKED`

### 2. mTLS proves the seam without being implemented

`AuthMTLS` is a real, registered `AuthType` and strategy — the strategy
body returns a clear "mTLS is not yet implemented" error rather than a
guessed certificate-handling attempt. This is the actual point of the
registry: adding it required zero changes to any other strategy file,
proving the extensibility the user asked for ("plan for it to be
extend easily... everything must be an addon not rewrite"). Same
treatment for `AuthOAuth1Vendor` (§ above). `LOCKED`

### 3. Config lives on `Connector`, secrets stay in the keychain as
opaque strings each strategy owns the encoding of

`Connector` gains one new field, `Auth *AuthConfig`
(`internal/domain/connector`), bundling the three new non-secret config
shapes (`OAuth2Config`, `HMACConfig`, `OAuth1Config`) behind one
optional pointer — additive, nil for every existing connector, same
"additive pointer field" shape `OpenAPISpec string`'s own history
already proved safe (ADR-0007). Secrets stay exactly where they already
live — `internal/adapters/credential`'s single keychain slot per
connector — but a scheme needing more than one secret-shaped value
(OAuth 1.0a's consumer secret *and* token secret) JSON-encodes a small
map into that one stored string rather than Mill inventing a
multi-secret-per-connector storage model. No `credential` adapter
change needed — `Set`/`Get` already just take/return a string; only the
call site's own encode/decode convention changes, contained entirely
inside `authoauth1.go`. `LOCKED`

### 4. OAuth 2.0 token fetch adopts `golang.org/x/oauth2/clientcredentials`

Already an indirect dependency (confirmed via `go.mod` before this
phase started) — promoted to direct. `client_credentials` is the one
grant type built (the only one the research actually specified fields
for); the package's own `Token()` call handles fetch + in-memory
caching + refresh-on-expiry, so Mill hand-rolls none of that. `LOCKED`

## Consequences

- `internal/domain/composition/integration.go`'s `nodeExec` for
  `integration-http` calls `ApplyAuth(...)` instead of the old
  two-line `AuthHeader` call — headers/query mutated in place before
  the request is built.
- `configureservice.go` gains new Auth-related params on
  `CreateConnector`/`UpdateConnector` — split into a new
  `configureservice_connectorauth.go` (the file was already at 418/500
  lines before this phase, confirmed in the plan's own survey; this
  split was planned before writing any code, not reacted to after
  hitting the limit).
- New: `internal/adapters/oauth2client` (thin wrapper around
  `clientcredentials`, ports/adapters rule) if the token-fetch call
  site needs more than a few lines.
- `ConnectorForm.tsx`'s Auth section renders per-AuthType config fields
  conditionally — the "progressive disclosure" pattern the reference
  platform's own review already named (`docs/SPEC.md` §3.2's Update).
- `docs/SPEC.md` §4.1's auth-type-catalogue row moves from `OPEN` to
  `LOCKED` for the 5 fully-implemented types; `OAuth1Vendor`/`mTLS`
  stay named, explicit, unimplemented stubs — not silently resolved.

## Update — implemented, all four Decision points built as designed

All nine `AuthType`s, the registry, and the five real strategies
(`AuthNone`/`AuthAPIKey`/`AuthBearer` migrated byte-identical,
`AuthHMAC`/`AuthOAuth1`/`AuthOAuth2`/`AuthQueryParam` newly built) plus
the two honest stubs (`AuthOAuth1Vendor`/`AuthMTLS`) are real, tested
code (`internal/domain/composition/auth*.go`,
`authstrategy_test.go` — 6 tests against real `httptest.Server`s,
including recomputing the HMAC signature and OAuth1 base-string
independently to assert an exact match, not just "no error").

- **`configureservice.go`'s split happened exactly as planned**: a new
  `configureservice_connectorauth.go` (275 lines) now owns every
  Connector CRUD/persistence method (`resolveConnector`, `Connectors`,
  `CreateConnector`/`UpdateConnector` — both gained the new `auth
  *connector.AuthConfig` param — `DeleteConnector`,
  `ListConnectorOperations`, `ConnectorOperationFields`,
  `SetConnectorSecret`/`DeleteConnectorSecret`, `persistConnectors`),
  plus a new `SetConnectorOAuth1Secret(id, consumerSecret, tokenSecret
  string) error` convenience method (§3's own JSON-dual-secret
  encoding, via the newly-exported `composition.EncodeOAuth1Secret`).
  `configureservice.go` itself dropped to 189 lines (Lists/Attributes/
  restore only). Both the split and the new param went in together,
  not reactively after crossing 500 — same order the plan specified.
- **§4's conditional `internal/adapters/oauth2client` was built, not
  skipped** — the token-source cache (a package-level `map[string]
  oauth2.TokenSource` + mutex) turned out to be real package-level
  *state*, the same shape `internal/adapters/httpconnector`'s own
  shared `*http.Client` already has — `.claude/rules/backend.md`'s
  domain-purity rule ("no persistence, no state" in
  `internal/domain/*`) means that state belongs in an adapter, not
  inline in `internal/domain/composition/authoauth2.go`. Caught during
  implementation, not assumed either way going in: the ADR's own §4
  had left this conditional ("if the token-fetch call site needs more
  than a few lines") — it did, so the adapter was built,
  `oauth2client.Token(clientID, clientSecret, tokenURL, scope)
  (tokenType, accessToken string, err error)`, unit-tested against a
  real `httptest.Server` including a real cache-reuse assertion (the
  token endpoint is hit exactly once across two calls with the same
  client/token-URL). `authoauth2.go` itself is now a thin strategy
  function calling the adapter, matching every other strategy file's
  shape.
- **A real regression test proves `Connector.Auth` survives a genuine
  persist→restore round trip**, not just that `CreateConnector`
  accepts the param: `TestCreateConnector_AuthConfig_
  PersistsAndSurvivesRestore` builds a second `ConfigureService` over
  the same `fakeStore` (the store's underlying map is shared, so this
  is a real JSON marshal/unmarshal round trip, not a mock) and asserts
  the restored connector's `Auth.OAuth2` fields match, and that
  `resolveConnector` threads `Auth` through to `ResolvedConnector`
  after that restore. `TestUpdateConnector_AuthConfig_Replaces` and
  two `SetConnectorOAuth1Secret` tests (encodes-and-round-trips,
  rejects-unknown-connector) round out the CRUD-layer coverage
  `authstrategy_test.go` doesn't reach (that file tests the strategies
  in isolation, not `ConfigureService`'s own persistence).
- **Frontend**: `ConnectorForm.tsx`'s Auth section renders per-AuthType
  fields via a flat, optional-field `ConnectorDraft` (not a
  discriminated union — only one group is ever populated/read at a
  time, driven by `authType`) — OAuth2 (Token URL/Client ID/Scope/
  Client secret), HMAC (header name + Secret), OAuth1 (Consumer key/
  Token + two secret fields, since RFC 5849 needs both). The two stubs
  (`AuthOAuth1Vendor`/`AuthMTLS`) are selectable but show an explicit
  "Not yet implemented" `Label` plus explanatory text — never presented
  as if they work. `AUTH_LABEL`/`AUTH_UNIMPLEMENTED` were factored into
  a small shared `configure/authTypeLabels.ts` (previously duplicated
  between `ConnectorForm.tsx` and `ConnectorSummary.tsx`) so the two
  never drift into different label sets for the same `AuthType`.
- Verified end-to-end via Playwright against the real Go backend
  (`frontend/e2e/connector-auth-types.spec.ts`, 3 new tests): an OAuth2
  connector's non-secret config round-trips through Save → Details tab
  → re-opened Edit (secret field correctly stays blank, write-only);
  an HMAC connector's custom header name persists the same way; mTLS
  shows the "Not yet implemented" label immediately on selection. Full
  suite (Go: build/vet/test -race/golangci-lint/check-loc; frontend:
  tsc/eslint/boundaries/vitest/build) green, complete Playwright e2e
  suite (49 tests) run twice in a row with no persisted-data leakage.
- **Not built, named explicitly**: `AuthOAuth1Vendor`/`AuthMTLS`'s real
  implementations (out of scope this goal, per the plan) — their
  strategies still return the deliberate "not yet implemented" error.
  `OAuth2Config.ContentType` is stored but unused (§4's own honest gap,
  unchanged). No UI exists to *test* an OAuth2/HMAC/OAuth1 connector's
  auth against a real endpoint from the Test tab beyond what
  `ConnectorTestPanel`'s existing `auth` passthrough already gives —
  it works (verified: `TestConnectorRequest.Auth` threads through to
  `ApplyAuth` exactly as a real workflow run would), just not
  separately re-verified per-AuthType in the Test tab specifically
  beyond what the e2e suite above already exercises.

## Update — Phase 3 (JOSE/JWE) implemented

**Research checkpoint, done before writing any encryption code**:
confirmed directly against `go-jose/go-jose/v4`'s own README algorithm
tables (fetched via `gh api`, not assumed from memory) that
`RSA-OAEP-256` (key encryption) and `A256GCM` (content encryption) are
both real, currently-supported algorithm identifiers — the stated
default this ADR's original plan named, now confirmed rather than
assumed. Apache-2.0, actively maintained (checked via `gh repo view`),
zero native/Rust dependency in its tree. `NewEncrypter`/`Encrypt`/
`CompactSerialize` and `ParseEncrypted`/`Decrypt` are the library's own
real API surface (confirmed by reading `crypter.go`/`jwe.go` directly,
not guessed) — notably `ParseEncrypted` in v4 requires an explicit
allowlist of key/content algorithms (an anti-algorithm-confusion
hardening the library added), which `internal/domain/composition/jose.go`
passes explicitly rather than accepting anything the wire claims.

**Decision — additive, independent of AuthType, exactly as planned**:
`connector.JOSEConfig{Enabled, Algorithm, ContentEncryption,
RecipientPublicKeyPEM, DecryptResponse}` is a new, optional field on
`Connector` (nil for every connector saved before this existed) —
`RecipientPublicKeyPEM` is not a secret (a public key) so it lives in
plain config; `Algorithm`/`ContentEncryption` default to
RSA-OAEP-256/A256GCM at execution time when empty (same "default
applied at use, not required at save" shape `HMACConfig.HeaderName`
already established in Phase 2) — no algorithm picker was built for a
single-supported-combo decision that doesn't exist yet, matching
`docs/SPEC.md` §3.5's "no UI for a decision that doesn't exist"
discipline. Mill's own private key (needed only when `DecryptResponse`
is true) goes in a **second, JOSE-specific keychain entry**
(`joseKeychainID(id) = id + ":jose"`) — distinct from whatever AuthType
secret the same connector already stores, since a connector can combine
JOSE with any auth scheme and the two secrets must never collide or
silently overwrite each other. `ConfigureService` gained
`SetConnectorJOSEPrivateKey`/`DeleteConnectorJOSEPrivateKey`
(write-only, mirroring `SetConnectorSecret`'s own shape) and
`CreateConnector`/`UpdateConnector` gained a `jose *connector.JOSEConfig`
param (9th positional arg now) — `DeleteConnector` was extended to also
best-effort-delete the JOSE keychain entry, so a deleted connector never
leaves an orphaned private key behind.

**Execution** (`internal/domain/composition/jose.go`,
`ApplyJOSEEncryption`/`DecryptJOSEResponse`, both exported like
`ApplyAuth` so `configureservice_connectortest.go`'s
`TestConnectorOperation` — package `main` — can reuse the identical
path a real workflow run goes through, per ADR-0013's "test exactly as
it would run" principle): request encryption happens in
`integration-http`'s `nodeExec` **before** `ApplyAuth` is called, so a
signing AuthType (HMAC/OAuth 1.0a) signs the ciphertext actually
transmitted, not the plaintext underneath it — a deliberate ordering
decision, not incidental. Response decryption happens **after** a
successful (< 400) HTTP response, before the payload is set on
`ExecContext` or output bindings are applied — everything downstream
sees decrypted plaintext, never a raw JWE string. Both are no-ops for a
connector with no JOSE config (nil-safe), so this is a strict superset,
zero behavior change for every connector that doesn't use it.
`parseRSAPublicKeyPEM`/`parseRSAPrivateKeyPEM` accept either PKIX/PKCS1
(public) or PKCS8/PKCS1 (private) PEM encodings, since a user could
plausibly paste either format from a vendor's own docs and there's no
way to know which in advance.

**Verified with real cryptography, not mocked**: `jose_test.go`
generates real 2048-bit RSA keypairs and round-trips through
`go-jose/v4`'s own raw API independently in both directions (encrypt
via this package, decrypt via go-jose directly; encrypt via go-jose
directly, decrypt via this package) — proving the produced strings are
genuine, standards-conformant JWE, not just "something this package's
own functions happen to accept." A full `ExecuteWorkflow` integration
test runs a real `integration-http` node against an `httptest.Server`
that itself decrypts the incoming request with a "vendor" private key
and re-encrypts its response with a *separate* "Mill" keypair — two
independent RSA keypairs, matching the real bidirectional shape
(`docs/SPEC.md` §3.2's Update: request encrypted to the vendor's key,
response encrypted back to Mill's own key), not one shared key
standing in for both directions. A wrong-private-key test confirms
decryption genuinely fails closed.

**Frontend**: `ConnectorForm.tsx` gained a "JOSE encryption" section
(Enable checkbox → Recipient public key PEM textarea + Decrypt-response
checkbox → Mill's private key PEM textarea, each level of nesting
gated behind the one above it — progressive disclosure, same pattern
Phase 2's Auth section already uses). `ConnectorSummary.tsx`'s Details
tab shows a "JOSE encryption" row (Disabled / Enabled / Enabled
(decrypts responses)). `ConnectorTestPanel.tsx` threads `jose`/
`josePrivateKeyPEM` through to `TestConnectorOperation` unchanged, same
parity principle as Phase 2's `auth` passthrough.

**`configureservice_test.go` split**, prompted by crossing 500 lines
once the new JOSE persistence/round-trip tests landed: a new
`configureservice_connectorauth_test.go` now holds every Connector
CRUD/Auth/JOSE test (mirrors the `configureservice_connectorauth.go`
source split from Phase 2); Lists/Attributes/MCP Server tests and the
shared `TestMain`/`newTestConfigureService` helpers stay in
`configureservice_test.go`.

Verified end-to-end via Playwright against the real Go backend
(`frontend/e2e/connector-jose.spec.ts`, 2 new tests): the Enable
toggle's progressive disclosure (fields appear/disappear correctly,
including toggling back off), the full round trip through Save →
Details tab → re-opened Edit (recipient public key reloads, private
key stays blank — write-only), and the Details tab's status text.
Full check suite (Go: build/vet/test -race/golangci-lint/check-loc;
frontend: tsc/eslint/boundaries/vitest/build) green, complete
Playwright e2e suite (48 tests) run twice in a row with no
persisted-data leakage.

**Not built, named explicitly**: no algorithm/content-encryption
picker (a single supported combo exists, per the "no UI for a decision
that doesn't exist" note above); no UI to configure a *non-default*
`Algorithm`/`ContentEncryption` (would require exposing `JOSEConfig`
fields the form currently leaves empty — real future work if a second
combo is ever actually needed); JOSE and mTLS both being layerable
simultaneously is untested since mTLS itself isn't implemented yet
(Phase 2's own stated scope cut, unchanged).

This closes the connector-capability-maturity goal's four planned
phases (Phase 0: Configure layout, Phase 1: schema-authoring maturity,
Phase 2: auth-type catalogue, Phase 3: JOSE/JWE) — ADR-0015's `Status`
stays `accepted` (covers Phase 2+3 together, both fully implemented).
