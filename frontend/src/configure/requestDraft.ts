import type { AuthConfig, HTTPRequest, JOSEConfig } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'

// The request form's draft shape and its pure to/from-wire helpers --
// split out of RequestForm.tsx along the data/JSX seam once ADR-0016
// Phase B's Method row pushed that file past the 500-line limit
// (.claude/rules/architecture.md). Also where requestHeaders.ts's
// HeaderRow now lives, so neither helper module type-imports the
// component file.

export interface HeaderRow {
  key: string
  value: string
}

export interface RequestDraft {
  label: string
  description: string
  baseURL: string
  // ADR-0016 Phase B: Method and URL are peers on the request object
  // (Postman/Bruno's shape) -- open text, any method accepted.
  method: string
  // Raw request body sent as-is when the schema's bound body fields
  // don't produce one -- request-level, never workflow-node-level.
  body: string
  authType: AuthType
  // Single-secret AuthTypes (APIKey/Bearer/HMAC's signing key/OAuth2's
  // ClientSecret) all reuse this one field -- OAuth1 is the exception
  // (RFC 5849 needs two secrets), see oauth1ConsumerSecret/
  // oauth1TokenSecret below.
  secret: string
  openAPISpec: string
  // ADR-0015's non-secret per-AuthType config -- one flat set of
  // optional fields rather than a discriminated union, since only one
  // group is ever populated/read at a time (driven by authType), and a
  // flat shape keeps draftFrom/handleSave from needing a switch just to
  // move values in and out of a nested shape.
  oauth2TokenURL: string
  oauth2ClientID: string
  oauth2Scope: string
  hmacHeaderName: string
  oauth1ConsumerKey: string
  oauth1Token: string
  oauth1ConsumerSecret: string
  oauth1TokenSecret: string
  // Phase 3 (JOSE) -- independent of authType (httprequest.JOSEConfig's
  // own doc comment: a request can combine JOSE with any auth scheme),
  // so these are never conditionally reset by an authType change the
  // way the oauth2*/hmac*/oauth1* fields above implicitly are (only the
  // *displayed* section changes per authType, not these).
  joseEnabled: boolean
  joseRecipientPublicKeyPEM: string
  joseDecryptResponse: boolean
  // Write-only, same shape as secret/oauth1*Secret above.
  josePrivateKeyPEM: string
}

export const EMPTY_DRAFT: RequestDraft = {
  label: '', description: '', baseURL: '', method: 'GET', body: '', authType: AuthType.AuthNone, secret: '', openAPISpec: '',
  oauth2TokenURL: '', oauth2ClientID: '', oauth2Scope: '',
  hmacHeaderName: '',
  oauth1ConsumerKey: '', oauth1Token: '', oauth1ConsumerSecret: '', oauth1TokenSecret: '',
  joseEnabled: false, joseRecipientPublicKeyPEM: '', joseDecryptResponse: false, josePrivateKeyPEM: '',
}

export function draftFrom(r: HTTPRequest): RequestDraft {
  return {
    label: r.Label, description: r.Description, baseURL: r.BaseURL, method: r.Method || 'GET', body: r.Body ?? '', authType: r.AuthType, secret: '', openAPISpec: r.OpenAPISpec,
    oauth2TokenURL: r.Auth?.OAuth2?.TokenURL ?? '',
    oauth2ClientID: r.Auth?.OAuth2?.ClientID ?? '',
    oauth2Scope: r.Auth?.OAuth2?.Scope ?? '',
    hmacHeaderName: r.Auth?.HMAC?.HeaderName ?? '',
    oauth1ConsumerKey: r.Auth?.OAuth1?.ConsumerKey ?? '',
    oauth1Token: r.Auth?.OAuth1?.Token ?? '',
    oauth1ConsumerSecret: '',
    oauth1TokenSecret: '',
    joseEnabled: r.JOSE?.Enabled ?? false,
    joseRecipientPublicKeyPEM: r.JOSE?.RecipientPublicKeyPEM ?? '',
    joseDecryptResponse: r.JOSE?.DecryptResponse ?? false,
    josePrivateKeyPEM: '',
  }
}

// authConfigFrom builds the Auth param CreateHTTPRequest/UpdateHTTPRequest/
// TestHTTPRequestOperation all take (ADR-0015) -- null for every
// AuthType with no non-secret config (None/APIKey/Bearer/QueryParam,
// and the two stubs), matching HTTPRequest.Auth's own "nil unless a
// real config-bearing AuthType" shape.
export function authConfigFrom(draft: RequestDraft): AuthConfig | null {
  switch (draft.authType) {
    case AuthType.AuthOAuth2:
      return { OAuth2: { GrantType: 'client_credentials', TokenURL: draft.oauth2TokenURL, ClientID: draft.oauth2ClientID, Scope: draft.oauth2Scope, ContentType: '' }, HMAC: null, OAuth1: null }
    case AuthType.AuthHMAC:
      return { OAuth2: null, HMAC: { HeaderName: draft.hmacHeaderName }, OAuth1: null }
    case AuthType.AuthOAuth1:
      return { OAuth2: null, HMAC: null, OAuth1: { ConsumerKey: draft.oauth1ConsumerKey, Token: draft.oauth1Token } }
    default:
      return null
  }
}

// joseConfigFrom builds the JOSE param (Phase 3) -- null when disabled,
// matching HTTPRequest.JOSE's own "nil unless a request actually uses
// it" shape. Algorithm/ContentEncryption are left empty so the domain
// layer's own stated defaults (RSA-OAEP-256/A256GCM,
// internal/domain/composition/jose.go) apply -- no picker for a
// single-supported-combo decision that doesn't exist yet, same "no UI
// for a decision that doesn't exist" discipline docs/SPEC.md §3.5
// already applies to single-option Selects.
export function joseConfigFrom(draft: RequestDraft): JOSEConfig | null {
  if (!draft.joseEnabled) return null
  return {
    Enabled: true, Algorithm: '', ContentEncryption: '',
    RecipientPublicKeyPEM: draft.joseRecipientPublicKeyPEM,
    DecryptResponse: draft.joseDecryptResponse,
  }
}
