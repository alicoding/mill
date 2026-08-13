import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'

// The full auth-type catalogue's display labels (ADR-0015, docs/SPEC.md
// §4.1) -- shared by RequestForm.tsx (the Select options) and
// RequestSummary.tsx (the read-only Details tab), so the two never
// drift into two different label sets for the same AuthType.
export function authLabelFor(t: (key: string) => string): Record<string, string> {
  return {
    [AuthType.AuthNone]: t('authTypeLabels.none'),
    [AuthType.AuthAPIKey]: t('authTypeLabels.apiKey'),
    [AuthType.AuthBearer]: t('authTypeLabels.bearer'),
    [AuthType.AuthHMAC]: t('authTypeLabels.hmac'),
    [AuthType.AuthOAuth1]: t('authTypeLabels.oauth1'),
    [AuthType.AuthOAuth1Vendor]: t('authTypeLabels.oauth1Vendor'),
    [AuthType.AuthOAuth2]: t('authTypeLabels.oauth2'),
    [AuthType.AuthQueryParam]: t('authTypeLabels.queryParam'),
    [AuthType.AuthMTLS]: t('authTypeLabels.mtls'),
  }
}

// AuthTypes whose strategy is a real, registered stub that always
// returns a "not yet implemented" error (ADR-0015) -- the UI must not
// present these as if they work. Kept as a small set here rather than
// inferred from AUTH_LABEL's own text, so the "not yet implemented"
// warning is driven by an explicit list, not a string-matching guess.
export const AUTH_UNIMPLEMENTED = new Set<string>([AuthType.AuthOAuth1Vendor, AuthType.AuthMTLS])
