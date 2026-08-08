// Package connector holds the core-domain shape of an Integration/
// Connector (docs/SPEC.md §3.5): a reusable (1:many), Configure-authored
// definition of how to reach an external HTTP API. Per CLAUDE.md's
// core-domain rule, the shape and its validation stay hand-written --
// no library has an opinion on Mill's own connector model. The actual
// HTTP call is internal/adapters/httpconnector's job; the secret itself
// never lives on a Connector value at all, only in
// internal/adapters/credential (the OS keychain), keyed by Connector.ID.
package connector

import (
	"fmt"
	"strings"
)

// AuthType is how a request authenticates against the connector's
// BaseURL. Grew from the original 3 to the full 7-option catalogue a
// reference-platform review found real (docs/SPEC.md §4.1, ADR-0015) --
// each type's actual request-mutation logic is a registered
// AuthStrategy (internal/domain/composition), not a switch here; this
// package only owns the type identifier and its config shape.
// AuthOAuth1Vendor and AuthMTLS are real, registered AuthTypes whose
// strategy deliberately returns "not yet implemented" (ADR-0015's own
// research checkpoint: OAuth1Vendor's exact vendor quirk and mTLS's
// full field set were both left unresolved even by the fuller research
// pass) -- proving the strategy registry accepts a new AuthType as a
// pure addition, without implementing behavior that was never actually
// specified.
type AuthType string

const (
	AuthNone   AuthType = "none"
	AuthAPIKey AuthType = "apikey"
	AuthBearer AuthType = "bearer"
	// AuthHMAC signs the request (method+path+timestamp+body) with
	// HMAC-SHA256, sent as X-Signature/X-Timestamp headers -- Mill's own
	// defensible default (ADR-0015's research checkpoint found no single
	// universal HMAC-auth convention to adopt instead).
	AuthHMAC AuthType = "hmac"
	// AuthOAuth1 is the real RFC 5849 standard, HMAC-SHA1 signature
	// method -- covers what the reference-platform research called
	// "OAuth 1.0 HMAC."
	AuthOAuth1 AuthType = "oauth1"
	// AuthOAuth1Vendor is the reference-platform research's own
	// "vendor-specific OAuth 1.0a variant" -- its actual quirk was never
	// confirmed (ADR-0015), so its strategy is a stub, not a guess.
	AuthOAuth1Vendor AuthType = "oauth1vendor"
	// AuthOAuth2 implements the client_credentials grant via
	// golang.org/x/oauth2/clientcredentials (already an indirect
	// dependency, promoted to direct).
	AuthOAuth2 AuthType = "oauth2"
	// AuthQueryParam places the resolved secret in the URL's query
	// string instead of a header.
	AuthQueryParam AuthType = "queryparam"
	// AuthMTLS is a real, registered AuthType whose strategy is a stub
	// -- explicitly out of scope for implementation this goal (decided
	// directly with the user), proving the seam accepts it as a pure
	// addition for whenever it is built.
	AuthMTLS AuthType = "mtls"
)

// OAuth2Config is AuthOAuth2's non-secret configuration -- ClientSecret
// itself stays in the OS keychain (internal/adapters/credential), same
// as every other AuthType's secret.
type OAuth2Config struct {
	// GrantType is fixed to "client_credentials" this pass -- the only
	// grant the reference-platform research actually specified fields
	// for (docs/SPEC.md §4.1). Kept as a field, not hardcoded, so a
	// second grant type is a config addition later, not a schema change.
	GrantType   string
	TokenURL    string
	ClientID    string
	Scope       string
	ContentType string
}

// HMACConfig is AuthHMAC's non-secret configuration. The signing key
// itself is the connector's keychain secret.
type HMACConfig struct {
	// HeaderName defaults to "X-Signature" when empty.
	HeaderName string
}

// OAuth1Config is AuthOAuth1's non-secret configuration (RFC 5849).
// ConsumerSecret/TokenSecret are JSON-encoded into the connector's one
// keychain secret slot rather than Mill inventing a multi-secret-per-
// connector storage model (ADR-0015 §3) -- Token itself is optional
// per RFC 5849 (2-legged OAuth omits it).
type OAuth1Config struct {
	ConsumerKey string
	Token       string
}

// AuthConfig bundles the non-secret config for whichever AuthType a
// Connector actually uses -- one additive, optional field on Connector
// (nil for every connector using none of these three), same "additive
// pointer field" shape OpenAPISpec's own history already proved safe
// (ADR-0007).
type AuthConfig struct {
	OAuth2 *OAuth2Config
	HMAC   *HMACConfig
	OAuth1 *OAuth1Config
}

// TypeHTTP is the one connector Type built today (§3.2: "build the
// generic HTTP connector first"). A DB/SOAP connector would add its own
// Type value here when a real need surfaces, not before.
const TypeHTTP = "http"

// Connector is one reusable, named way to reach an external API.
// Headers are static, always-sent headers (e.g. "Accept": "application/
// json") -- distinct from the AuthType-driven Authorization header,
// which internal/adapters/httpconnector adds itself from the resolved
// secret, never stored here.
type Connector struct {
	ID       string
	Label    string
	Type     string
	BaseURL  string
	AuthType AuthType
	Headers  map[string]string
	// OpenAPISpec is the raw OpenAPI 3.x document (JSON or YAML) this
	// connector's operations are declared against -- optional (ADR-0007).
	// Parsed via internal/adapters/openapispec. A Connector with no spec
	// behaves exactly as before this field existed.
	OpenAPISpec string
	// Auth is the non-secret config for AuthOAuth2/AuthHMAC/AuthOAuth1
	// (ADR-0015) -- nil for AuthNone/AuthAPIKey/AuthBearer and every
	// connector saved before this field existed.
	Auth *AuthConfig
}

// Validate checks a Connector is well-formed before it's persisted --
// the same "never store an unconfigured/invalid value" discipline
// internal/domain/composition's ResolveNodeDefaults already applies to
// Nodes, applied here to Connectors.
func Validate(c Connector) error {
	if strings.TrimSpace(c.Label) == "" {
		return fmt.Errorf("a connector needs a label")
	}
	if c.Type != TypeHTTP {
		return fmt.Errorf("unsupported connector type: %q (only %q is supported today)", c.Type, TypeHTTP)
	}
	if strings.TrimSpace(c.BaseURL) == "" {
		return fmt.Errorf("a connector needs a base URL")
	}
	switch c.AuthType {
	case AuthNone, AuthAPIKey, AuthBearer, AuthHMAC, AuthOAuth1, AuthOAuth1Vendor, AuthOAuth2, AuthQueryParam, AuthMTLS:
	default:
		return fmt.Errorf("unsupported auth type: %q", c.AuthType)
	}
	return nil
}
