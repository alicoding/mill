import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/connector/models'

// The full auth-type catalogue's display labels (ADR-0015, docs/SPEC.md
// §4.1) -- shared by ConnectorForm.tsx (the Select options) and
// ConnectorSummary.tsx (the read-only Details tab), so the two never
// drift into two different label sets for the same AuthType.
export const AUTH_LABEL: Record<string, string> = {
  [AuthType.AuthNone]: 'None',
  [AuthType.AuthAPIKey]: 'API key',
  [AuthType.AuthBearer]: 'Bearer token',
  [AuthType.AuthHMAC]: 'HMAC signature',
  [AuthType.AuthOAuth1]: 'OAuth 1.0a (HMAC-SHA1)',
  [AuthType.AuthOAuth1Vendor]: 'OAuth 1.0a (vendor variant)',
  [AuthType.AuthOAuth2]: 'OAuth 2.0 (client credentials)',
  [AuthType.AuthQueryParam]: 'Query parameter',
  [AuthType.AuthMTLS]: 'Mutual TLS (mTLS)',
}

// AuthTypes whose strategy is a real, registered stub that always
// returns a "not yet implemented" error (ADR-0015) -- the UI must not
// present these as if they work. Kept as a small set here rather than
// inferred from AUTH_LABEL's own text, so the "not yet implemented"
// warning is driven by an explicit list, not a string-matching guess.
export const AUTH_UNIMPLEMENTED = new Set<string>([AuthType.AuthOAuth1Vendor, AuthType.AuthMTLS])
